import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { RequestLogEntry, setLogSink } from '@packages/context/log-sink';
import { resolveServiceHost, TraceContextInterceptor } from './trace-context.interceptor';

function rpcContext(pattern: string): ExecutionContext {
  return {
    getType: () => 'rpc',
    getHandler: () => ({ name: 'handler' }),
    switchToRpc: () => ({
      getData: () => ({ a: 1 }),
      getContext: () => ({
        getPattern: () => pattern,
        getMessage: () => ({ properties: { headers: {} } }),
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('TraceContextInterceptor host', () => {
  const original = { host: process.env.SERVICE_HOST, port: process.env.PORT };

  afterEach(() => {
    jest.restoreAllMocks();
    if (original.host === undefined) delete process.env.SERVICE_HOST;
    else process.env.SERVICE_HOST = original.host;
    if (original.port === undefined) delete process.env.PORT;
    else process.env.PORT = original.port;
  });

  it('uses SERVICE_HOST when set', () => {
    process.env.SERVICE_HOST = 'svc:50051';
    expect(resolveServiceHost()).toBe('svc:50051');
  });

  it('falls back to SERVICE_NAME:PORT', () => {
    delete process.env.SERVICE_HOST;
    process.env.PORT = '4002';
    expect(resolveServiceHost()).toMatch(/^[a-z-]+-service:4002$/);
  });

  it('includes host in the emitted log entry', async () => {
    process.env.SERVICE_HOST = 'svc:50051';
    const spy = jest.fn<unknown, [RequestLogEntry]>();
    setLogSink(spy);
    const next: CallHandler = { handle: () => of('ok') };
    await lastValueFrom(new TraceContextInterceptor().intercept(rpcContext('some.pattern'), next));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ host: 'svc:50051', type: 'RPC' }));
  });
});
