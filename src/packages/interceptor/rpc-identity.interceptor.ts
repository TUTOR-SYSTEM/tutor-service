import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';
import { from, Observable, switchMap, throwError } from 'rxjs';
import {
  carriesIdentity,
  RPC_IDENTITY_MAX_AGE_MS,
  stripRpcIdentitySeal,
  verifyRpcIdentity,
} from '@packages/helpers/rpc-identity.helper';

/** Claims a replay key for `windowSeconds`. Returns true for the first claim, false for a replay. */
export type ReplayClaim = (key: string, windowSeconds: number) => Promise<boolean>;

/**
 * Remembers the seal of each accepted RPC message for the freshness window, so a captured envelope
 * cannot be delivered twice. The key is `identityBind` (MAC over pattern, payload and timestamp), so
 * a replay is byte-identical. The claim is shared: it goes through third-service's `redis.incr`, the
 * same counter user-service uses, so every tutor-service replica sees the same replays. Fails closed:
 * an error from the store is a refusal.
 */
export class RpcReplayGuard {
  private readonly logger = new Logger(RpcReplayGuard.name);

  constructor(private readonly claim: ReplayClaim) {}

  async accept(key: string): Promise<boolean> {
    try {
      return await this.claim(key, Math.ceil(RPC_IDENTITY_MAX_AGE_MS / 1000));
    } catch (error) {
      // Fail closed, but say why: a refused store looks like a replay from the outside.
      this.logger.warn(`Replay counter failed, refusing the message: ${(error as Error).message}`);
      return false;
    }
  }
}

/** Key family third-service accepts for `redis.incr` (INCR_ALLOWED_PREFIXES, redis-keys.policy.ts). */
export const REPLAY_KEY_PREFIX = 'rpc-actor-replay:';

/**
 * Responder side of the identity seal (see rpc-identity.helper.ts). A message that names a user or a
 * role is honoured only when it was sealed with RPC_ACTOR_SECRET, is fresh, and has not been seen
 * before (RpcReplayGuard); anything else gets 403. The seal fields are removed before the handler runs.
 */
@Injectable()
export class RpcIdentityInterceptor implements NestInterceptor {
  constructor(
    private readonly secret: string,
    private readonly replayGuard: RpcReplayGuard,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') return next.handle();
    const rpc = context.switchToRpc();
    const data = rpc.getData<unknown>();
    if (!carriesIdentity(data)) return next.handle();
    const pattern = rpc.getContext<RmqContext>().getPattern();
    if (!verifyRpcIdentity(pattern, data, this.secret)) {
      throw new ForbiddenException('FORBIDDEN_RPC_IDENTITY');
    }
    // verify first, so unsigned traffic never reaches the shared counter
    const bind = (data as { identityBind: string }).identityBind;
    return from(this.replayGuard.accept(`${REPLAY_KEY_PREFIX}${bind}`)).pipe(
      switchMap((fresh) => {
        if (!fresh) return throwError(() => new ForbiddenException('FORBIDDEN_RPC_IDENTITY'));
        stripRpcIdentitySeal(data);
        return next.handle();
      }),
    );
  }
}
