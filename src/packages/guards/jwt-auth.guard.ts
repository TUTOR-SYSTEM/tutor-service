import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '@packages/decorators';
import { DRIZZLE } from 'src/database/database.module';
import type { Request } from 'express';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';

import type { JwtUserRole } from '@packages/helpers';
import { ERROR_MESSAGES } from 'src/data/constants';
import { RmqProducer } from 'src/features/rabbitmq/rmq.producer';
import { resolveJwtAccessSecret } from '../configs/jwt-sign.config';
import { users } from 'src/database/schema';

/** Access-token payload shape (matches access JWTs from `signAccessToken`). */
export type JwtGuardUser = {
  id: string;
  email: string;
  typ: 'access';
  role: JwtUserRole;
  sid: string;
};

type RequestWithUser = Request & { user?: JwtGuardUser };

/** A session verified against redis is trusted for this long within this process. */
export const SESSION_CACHE_TTL_MS = 5_000;
const SESSION_CACHE_MAX_ENTRIES = 10_000;
const SESSION_CHECK_TIMEOUT_MS = 2_000;
const SESSION_CHECK_RETRIES = 1;

function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization || typeof authorization !== 'string') {
    return undefined;
  }
  const [scheme, value] = authorization.split(' ');
  if (scheme !== 'Bearer' || !value) {
    return undefined;
  }
  return value;
}

const JWT_ROLES: readonly JwtUserRole[] = ['STUDENT', 'ADMIN', 'TUTOR', 'PARENT'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseJwtUserRole(value: unknown): JwtUserRole {
  if (typeof value != 'string') throw new UnauthorizedException('Check role user failed ...');
  if (typeof value === 'string' && (JWT_ROLES as readonly string[]).includes(value)) {
    return value as JwtUserRole;
  }
  return 'STUDENT';
}

function parseAccessPayload(decoded: unknown): JwtGuardUser {
  if (typeof decoded !== 'object' || decoded === null) {
    throw new UnauthorizedException('Unauthorized ...');
  }
  const o = decoded as Record<string, unknown>;
  if (o.typ !== 'access' || typeof o.sub !== 'string' || typeof o.email !== 'string') {
    throw new UnauthorizedException('Unauthorized ...');
  }
  // tokens minted before session ids existed (no `sid`) are rejected: the user logs in again
  if (typeof o.sid !== 'string' || !UUID_RE.test(o.sid)) {
    throw new UnauthorizedException('Unauthorized ...');
  }
  return {
    id: o.sub,
    email: o.email,
    typ: 'access',
    role: parseJwtUserRole(o.role),
    sid: o.sid,
  };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly db: PostgresJsDatabase<Record<string, never>>;
  // `${userId}:${sid}` -> expiry (ms epoch) of a session confirmed live in redis
  private readonly confirmedSessions = new Map<string, number>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    @Inject(DRIZZLE) private readonly drizzleDB: PostgresJsDatabase<Record<string, never>>,
    private readonly rmqProducer: RmqProducer,
  ) {
    this.db = drizzleDB;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = bearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('Unauthorized ...');
    }

    const accessSecret = resolveJwtAccessSecret(this.configService);

    let decoded: unknown;
    try {
      decoded = this.jwtService.verify(token, {
        secret: accessSecret,
      });
    } catch {
      throw new UnauthorizedException('Unauthorized ...');
    }

    const payload = parseAccessPayload(decoded);
    request.user = payload;

    const user = await this.db
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, payload.id))
      .limit(1);

    if (user.length === 0 || user[0].isActive === false) {
      throw new UnauthorizedException('Unauthorized ...');
    }

    await this.assertSessionLive(payload.id, payload.sid);
    return true;
  }

  /**
   * Logout, password change, deactivation and role change all delete the session key in redis,
   * so a still-unexpired access token stops working at once. Fail closed on redis trouble unless
   * SESSION_CHECK_FAIL_OPEN=true is set explicitly.
   */
  private async assertSessionLive(userId: string, sid: string): Promise<void> {
    const cacheKey = `${userId}:${sid}`;
    const confirmedUntil = this.confirmedSessions.get(cacheKey);
    if (confirmedUntil !== undefined && confirmedUntil > Date.now()) {
      return;
    }

    let live: boolean;
    try {
      live = await this.rmqProducer.send<boolean, { key: string }>(
        'redis.exists',
        { key: `session:${userId}:${sid}` },
        SESSION_CHECK_TIMEOUT_MS,
        SESSION_CHECK_RETRIES,
      );
    } catch (error) {
      if (this.failOpen()) {
        this.logger.warn(`session check unavailable, failing open: ${String(error)}`);
        return;
      }
      throw new ServiceUnavailableException(ERROR_MESSAGES.SESSION_CHECK_UNAVAILABLE);
    }

    if (live !== true) {
      this.confirmedSessions.delete(cacheKey);
      throw new UnauthorizedException(ERROR_MESSAGES.SESSION_REVOKED);
    }

    if (this.confirmedSessions.size >= SESSION_CACHE_MAX_ENTRIES) {
      this.confirmedSessions.clear();
    }
    this.confirmedSessions.set(cacheKey, Date.now() + SESSION_CACHE_TTL_MS);
  }

  private failOpen(): boolean {
    return process.env.SESSION_CHECK_FAIL_OPEN === 'true';
  }
}
