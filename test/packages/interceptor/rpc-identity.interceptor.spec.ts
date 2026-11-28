import { ForbiddenException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import {
  RpcIdentityInterceptor,
  RpcReplayGuard,
} from '@packages/interceptor/rpc-identity.interceptor';
import { sealRpcIdentity } from '@packages/helpers/rpc-identity.helper';

const SECRET = 'test-secret';

function rpcContext(pattern: string, data: unknown): ExecutionContext {
  return {
    getType: () => 'rpc',
    switchToRpc: () => ({
      getData: () => data,
      getContext: () => ({ getPattern: () => pattern }),
    }),
  } as unknown as ExecutionContext;
}

const next = (seen: { data?: unknown }): CallHandler => ({
  handle: () => {
    seen.data = 'handled';
    return of('ok');
  },
});

/** A shared counter stand-in: the first claim of a key wins, like redis.incr === 1. */
function sharedCounter() {
  const seen = new Set<string>();
  return jest.fn(async (key: string) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

describe('RpcIdentityInterceptor', () => {
  const interceptor = new RpcIdentityInterceptor(SECRET, new RpcReplayGuard(sharedCounter()));

  it('passes a sealed message and strips the seal before the handler', async () => {
    const sealed = sealRpcIdentity({ userId: 'u1', role: 'TUTOR' }, 'class.getAll', SECRET);
    const data = { ...sealed };
    const seen: { data?: unknown } = {};
    const out = await lastValueFrom(
      interceptor.intercept(rpcContext('class.getAll', data), next(seen)),
    );
    expect(out).toBe('ok');
    expect(seen.data).toBe('handled');
    expect(data).toEqual({ userId: 'u1', role: 'TUTOR' });
  });

  it('rejects an unsealed message that names a user with 403', () => {
    expect(() =>
      interceptor.intercept(rpcContext('class.delete', { userId: 'u1', role: 'ADMIN' }), next({})),
    ).toThrow(ForbiddenException);
  });

  it('lets messages without identity through', async () => {
    await expect(
      lastValueFrom(interceptor.intercept(rpcContext('redis.get', { key: 'k' }), next({}))),
    ).resolves.toBe('ok');
  });
});

describe('RpcIdentityInterceptor replay guard (TS-01)', () => {
  it('rejects the same sealed envelope delivered a second time', async () => {
    const interceptor = new RpcIdentityInterceptor(SECRET, new RpcReplayGuard(sharedCounter()));
    const sealed = sealRpcIdentity({ userId: 'u1', role: 'TUTOR' }, 'class.delete', SECRET);
    await lastValueFrom(interceptor.intercept(rpcContext('class.delete', { ...sealed }), next({})));
    await expect(
      lastValueFrom(interceptor.intercept(rpcContext('class.delete', { ...sealed }), next({}))),
    ).rejects.toThrow(ForbiddenException);
  });

  it('shares the counter across instances: a replay on a second replica is refused', async () => {
    const counter = sharedCounter();
    const replicaA = new RpcIdentityInterceptor(SECRET, new RpcReplayGuard(counter));
    const replicaB = new RpcIdentityInterceptor(SECRET, new RpcReplayGuard(counter));
    const sealed = sealRpcIdentity({ userId: 'u1', role: 'TUTOR' }, 'class.delete', SECRET);
    await lastValueFrom(replicaA.intercept(rpcContext('class.delete', { ...sealed }), next({})));
    await expect(
      lastValueFrom(replicaB.intercept(rpcContext('class.delete', { ...sealed }), next({}))),
    ).rejects.toThrow(ForbiddenException);
  });

  it('counts the replay under a key family third-service accepts for redis.incr', async () => {
    const claim = sharedCounter();
    const interceptor = new RpcIdentityInterceptor(SECRET, new RpcReplayGuard(claim));
    const sealed = sealRpcIdentity({ userId: 'u1', role: 'TUTOR' }, 'class.delete', SECRET);
    await lastValueFrom(interceptor.intercept(rpcContext('class.delete', { ...sealed }), next({})));
    expect(claim.mock.calls[0][0]).toMatch(/^rpc-actor-replay:/);
  });

  it('fails closed when the shared store errors', async () => {
    const guard = new RpcReplayGuard(async () => {
      throw new Error('redis down');
    });
    await expect(guard.accept('k')).resolves.toBe(false);
  });
});
