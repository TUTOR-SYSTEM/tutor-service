import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import {
  CORRELATION_ID_HEADER,
  getRequestContext,
  PARENT_TRACE_ID_HEADER,
  SERVICE_NAME_HEADER,
} from '@packages/context/request-context';
import { TraceContextInterceptor } from 'src/packages/interceptor/trace-context.interceptor';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type RpcOptions = {
  pattern?: string;
  headers?: Record<string, unknown>;
  type?: string;
};

function rpcContext(opts: RpcOptions = {}): ExecutionContext {
  const { pattern = 'some.pattern', headers = {}, type = 'rpc' } = opts;
  return {
    getType: () => type,
    getHandler: () => ({ name: 'handlerName' }),
    switchToRpc: () => ({
      getData: () => ({ a: 1 }),
      getContext: () => ({
        getPattern: () => pattern,
        getMessage: () => ({ properties: { headers } }),
      }),
    }),
  } as unknown as ExecutionContext;
}

const handlerReturning = (value: unknown): CallHandler => ({ handle: () => of(value) });

describe('TraceContextInterceptor', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  const interceptor = new TraceContextInterceptor();

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes non-RPC calls straight through', async () => {
    const handle = jest.fn(() => of('http-body'));
    const result = await lastValueFrom(
      interceptor.intercept(rpcContext({ type: 'http' }), { handle }),
    );
    expect(result).toBe('http-body');
    expect(handle).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('reuses the caller correlationId and records its traceId as the parent', async () => {
    const headers = {
      [CORRELATION_ID_HEADER]: 'corr-123',
      [PARENT_TRACE_ID_HEADER]: 'parent-456',
      [SERVICE_NAME_HEADER]: 'gateway',
    };
    let seen: ReturnType<typeof getRequestContext>;
    const handle = () => {
      seen = getRequestContext();
      return of('ok');
    };

    await lastValueFrom(interceptor.intercept(rpcContext({ headers }), { handle }));

    expect(seen).toMatchObject({
      correlationId: 'corr-123',
      parentTraceId: 'parent-456',
      serviceName: 'tutor-service',
    });
    expect(seen?.traceId).toMatch(UUID_RE);
    expect(seen?.traceId).not.toBe('parent-456');
  });

  it('decodes Buffer header values as UTF-8', async () => {
    const headers = { [CORRELATION_ID_HEADER]: Buffer.from('buf-corr', 'utf8') };
    let seen: ReturnType<typeof getRequestContext>;
    await lastValueFrom(
      interceptor.intercept(rpcContext({ headers }), {
        handle: () => {
          seen = getRequestContext();
          return of(null);
        },
      }),
    );
    expect(seen?.correlationId).toBe('buf-corr');
  });

  it('generates a fresh UUID correlationId when headers are missing', async () => {
    let seen: ReturnType<typeof getRequestContext>;
    await lastValueFrom(
      interceptor.intercept(rpcContext(), {
        handle: () => {
          seen = getRequestContext();
          return of(null);
        },
      }),
    );
    expect(seen?.correlationId).toMatch(UUID_RE);
    expect(seen?.parentTraceId).toBeUndefined();
  });

  it('ignores non-string, non-Buffer header values', async () => {
    const headers = { [CORRELATION_ID_HEADER]: 42, [SERVICE_NAME_HEADER]: { x: 1 } };
    await lastValueFrom(interceptor.intercept(rpcContext({ headers }), handlerReturning(null)));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('from=unknown'));
  });

  it('uses the handler name when the RMQ context has no pattern', async () => {
    const context = {
      getType: () => 'rpc',
      getHandler: () => ({ name: 'fallbackHandler' }),
      switchToRpc: () => ({
        getData: () => ({}),
        getContext: () => ({ getMessage: () => ({ properties: { headers: {} } }) }),
      }),
    } as unknown as ExecutionContext;
    await lastValueFrom(interceptor.intercept(context, handlerReturning(null)));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[RPC] fallbackHandler'));
  });

  it('logs the caller service name on entry and exit', async () => {
    const headers = { [CORRELATION_ID_HEADER]: 'c1', [SERVICE_NAME_HEADER]: 'gateway' };
    await lastValueFrom(interceptor.intercept(rpcContext({ headers }), handlerReturning(1)));
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[RPC\] some\.pattern <- correlationId=c1 traceId=\S+ from=gateway$/),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[RPC\] some\.pattern -> correlationId=c1 .* - \d+ms$/),
    );
  });

  it('logs the failure and re-throws the original error', async () => {
    const boom = new Error('kaboom');
    await expect(
      lastValueFrom(interceptor.intercept(rpcContext(), { handle: () => throwError(() => boom) })),
    ).rejects.toBe(boom);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[RPC ERROR] some.pattern'));
  });
});
