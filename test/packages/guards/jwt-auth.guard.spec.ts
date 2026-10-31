import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { ERROR_MESSAGES } from 'src/data/constants';
import { JwtAuthGuard, SESSION_CACHE_TTL_MS } from '@packages/guards/jwt-auth.guard';
import type { RmqProducer } from 'src/features/rabbitmq/rmq.producer';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';

const accessClaims = (overrides: Record<string, unknown> = {}) => ({
  sub: USER_ID,
  email: 'tutor@example.com',
  typ: 'access',
  role: 'TUTOR',
  sid: SID,
  ...overrides,
});

const contextFor = (authorization?: string) => {
  const request: { headers: Record<string, string>; user?: unknown } = {
    headers: authorization ? { authorization } : {},
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { context, request };
};

describe('JwtAuthGuard (session + active-user checks)', () => {
  let guard: JwtAuthGuard;
  let jwt: { verify: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };
  let userRows: unknown[];
  let rmq: { send: jest.Mock };
  let db: { select: jest.Mock };

  beforeEach(() => {
    delete process.env.SESSION_CHECK_FAIL_OPEN;
    jwt = { verify: jest.fn().mockReturnValue(accessClaims()) };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    userRows = [{ id: USER_ID, isActive: true }];
    db = {
      select: jest.fn(() => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve(userRows) }),
        }),
      })),
    };
    rmq = { send: jest.fn().mockResolvedValue(true) };
    const config = { get: jest.fn().mockReturnValue('access-secret') } as unknown as ConfigService;

    guard = new JwtAuthGuard(
      jwt as unknown as JwtService,
      config,
      reflector as unknown as Reflector,
      db as never,
      rmq as unknown as RmqProducer,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lets @Public() routes through without a token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { context } = contextFor();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(rmq.send).not.toHaveBeenCalled();
  });

  it('rejects a request without a bearer token', async () => {
    const { context } = contextFor();

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects legacy tokens that carry no sid claim (no session or DB lookup)', async () => {
    jwt.verify.mockReturnValue(accessClaims({ sid: undefined }));
    const { context } = contextFor('Bearer legacy');

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(db.select).not.toHaveBeenCalled();
    expect(rmq.send).not.toHaveBeenCalled();
  });

  it('rejects a token whose user no longer exists or is deactivated', async () => {
    userRows = [{ id: USER_ID, isActive: false }];
    const { context } = contextFor('Bearer t');

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(rmq.send).not.toHaveBeenCalled();
  });

  it('accepts a live session and exposes sid on request.user', async () => {
    const { context, request } = contextFor('Bearer t');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(rmq.send).toHaveBeenCalledWith(
      'redis.exists',
      { key: `session:${USER_ID}:${SID}` },
      expect.any(Number),
      expect.any(Number),
    );
    expect(request.user).toMatchObject({ id: USER_ID, role: 'TUTOR', sid: SID });
  });

  it('rejects a revoked session (logged out / password changed)', async () => {
    rmq.send.mockResolvedValue(false);
    const { context } = contextFor('Bearer t');

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException(ERROR_MESSAGES.SESSION_REVOKED),
    );
  });

  it('fails closed with 503 when the session store is unreachable', async () => {
    rmq.send.mockRejectedValue(new Error('broker down'));
    const { context } = contextFor('Bearer t');

    await expect(guard.canActivate(context)).rejects.toThrow(ServiceUnavailableException);
  });

  it('fails open only when SESSION_CHECK_FAIL_OPEN=true is set explicitly', async () => {
    process.env.SESSION_CHECK_FAIL_OPEN = 'true';
    rmq.send.mockRejectedValue(new Error('broker down'));
    const { context } = contextFor('Bearer t');

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('caches a confirmed session for a few seconds, then checks redis again', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { context: first } = contextFor('Bearer t');
    const { context: second } = contextFor('Bearer t');

    await guard.canActivate(first);
    now.mockReturnValue(1_000_000 + SESSION_CACHE_TTL_MS - 1);
    await guard.canActivate(second);
    expect(rmq.send).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_000_000 + SESSION_CACHE_TTL_MS + 1);
    await guard.canActivate(second);
    expect(rmq.send).toHaveBeenCalledTimes(2);
  });

  it('does not cache a revoked session, so a later re-check sees the truth', async () => {
    rmq.send.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { context } = contextFor('Bearer t');

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(rmq.send).toHaveBeenCalledTimes(2);
  });
});
