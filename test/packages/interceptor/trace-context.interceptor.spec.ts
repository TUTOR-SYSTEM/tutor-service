import { CallHandler, ExecutionContext, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import {
  CORRELATION_ID_HEADER,
  getRequestContext,
  PARENT_TRACE_ID_HEADER,
  SERVICE_NAME_HEADER,
} from '@packages/context/request-context';
import { RequestLogEntry, setLogSink } from '@packages/context/log-sink';
import {
  resolveServiceHost,
  TraceContextInterceptor,
} from 'src/packages/interceptor/trace-context.interceptor';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type RpcOptions = {
  pattern?: string;
  data?: unknown;
  headers?: Record<string, unknown>;
  type?: string;
};

function rpcContext(opts: RpcOptions = {}): ExecutionContext {
  const { pattern = 'some.pattern', headers = {}, type = 'rpc' } = opts;
  // an explicit `data: undefined` must reach the interceptor as undefined, so check key presence
  const payload = 'data' in opts ? opts.data : { a: 1 };
  return {
    getType: () => type,
    getHandler: () => ({ name: 'handlerName' }),
    switchToRpc: () => ({
      getData: () => payload,
      getContext: () => ({
        getPattern: () => pattern,
        getMessage: () => ({ properties: { headers } }),
      }),
    }),
  } as unknown as ExecutionContext;
}

const handlerReturning = (value: unknown): CallHandler => ({ handle: () => of(value) });

describe('TraceContextInterceptor', () => {
  let sink: jest.Mock<unknown, [RequestLogEntry]>;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  const interceptor = new TraceContextInterceptor();

  beforeEach(() => {
    sink = jest.fn();
    setLogSink(sink);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('non-RPC contexts', () => {
    it('passes HTTP calls straight through without logging or emitting', async () => {
      const handle = jest.fn(() => of('http-body'));

      const result = await lastValueFrom(
        interceptor.intercept(rpcContext({ type: 'http' }), { handle }),
      );

      expect(result).toBe('http-body');
      expect(handle).toHaveBeenCalledTimes(1);
      expect(sink).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('correlation and trace headers', () => {
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
      expect(sink).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'corr-123', parentTraceId: 'parent-456' }),
      );
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

    it('generates a fresh UUID correlationId and leaves parentTraceId undefined when headers are missing', async () => {
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

    it('ignores non-string, non-Buffer header values and generates a correlationId instead', async () => {
      const headers = { [CORRELATION_ID_HEADER]: 42, [SERVICE_NAME_HEADER]: { x: 1 } };

      await lastValueFrom(interceptor.intercept(rpcContext({ headers }), handlerReturning(null)));

      expect(sink.mock.calls[0][0].correlationId).toMatch(UUID_RE);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('from=unknown'));
    });

    it('logs the caller service name on entry and exit', async () => {
      const headers = { [CORRELATION_ID_HEADER]: 'c1', [SERVICE_NAME_HEADER]: 'gateway' };

      await lastValueFrom(interceptor.intercept(rpcContext({ headers }), handlerReturning(1)));

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /^\[RPC\] some\.pattern <- correlationId=c1 traceId=\S+ from=gateway$/,
        ),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[RPC\] some\.pattern -> correlationId=c1 .* - \d+ms$/),
      );
    });
  });

  describe('request log entries', () => {
    it('emits one RPC entry with the request payload and handler response', async () => {
      await lastValueFrom(
        interceptor.intercept(
          rpcContext({ pattern: 'class.getClass', data: { id: 'k1' } }),
          handlerReturning({ id: 'k1', name: 'Math' }),
        ),
      );

      expect(sink).toHaveBeenCalledTimes(1);
      expect(sink).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceName: 'tutor-service',
          type: 'RPC',
          path: 'class.getClass',
          requestBody: JSON.stringify({ id: 'k1' }),
          responseBody: JSON.stringify({ id: 'k1', name: 'Math' }),
          durationMs: expect.any(Number),
        }),
      );
    });

    it('redacts sensitive keys in the request and response previews, including nested ones', async () => {
      const data = {
        email: 'a@b.dev',
        password: 'p1',
        nested: { refreshToken: 'r1', list: [{ oldPassword: 'o1', ok: true }] },
      };

      await lastValueFrom(
        interceptor.intercept(rpcContext({ data }), handlerReturning({ accessToken: 'a1', id: 1 })),
      );

      const entry = sink.mock.calls[0][0];
      expect(JSON.parse(entry.requestBody as string)).toEqual({
        email: 'a@b.dev',
        password: '[REDACTED]',
        nested: { refreshToken: '[REDACTED]', list: [{ oldPassword: '[REDACTED]', ok: true }] },
      });
      expect(JSON.parse(entry.responseBody as string)).toEqual({
        accessToken: '[REDACTED]',
        id: 1,
      });
    });

    it('leaves requestBody and responseBody undefined when the payload is undefined', async () => {
      await lastValueFrom(
        interceptor.intercept(rpcContext({ data: undefined }), handlerReturning(undefined)),
      );

      expect(sink.mock.calls[0][0].requestBody).toBeUndefined();
      expect(sink.mock.calls[0][0].responseBody).toBeUndefined();
    });

    it('truncates long previews to 1000 characters with a marker', async () => {
      const big = 'x'.repeat(5000);

      await lastValueFrom(
        interceptor.intercept(rpcContext({ data: { big } }), handlerReturning({ big })),
      );

      const entry = sink.mock.calls[0][0];
      expect(entry.requestBody).toMatch(/…\(truncated\)$/);
      expect((entry.requestBody as string).length).toBeLessThan(1100);
      expect(entry.responseBody).toMatch(/…\(truncated\)$/);
    });

    it('does not emit a request log for log.* patterns (the logging plumbing itself)', async () => {
      await lastValueFrom(
        interceptor.intercept(
          rpcContext({ pattern: 'log.write', data: { a: 1 } }),
          handlerReturning(1),
        ),
      );

      expect(sink).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[RPC] log.write <-'));
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

      expect(sink.mock.calls[0][0].path).toBe('fallbackHandler');
    });

    it('still runs the handler when the payload cannot be serialized', async () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      const result = await lastValueFrom(
        interceptor.intercept(rpcContext({ data: cyclic }), handlerReturning('done')),
      );

      expect(result).toBe('done');
      expect(sink.mock.calls[0][0].requestBody).toBeUndefined();
    });
  });

  describe('error path', () => {
    it('re-throws the original error to the caller', async () => {
      const boom = new Error('kaboom');

      await expect(
        lastValueFrom(
          interceptor.intercept(rpcContext(), { handle: () => throwError(() => boom) }),
        ),
      ).rejects.toBe(boom);
    });

    it('logs the failure and emits an entry carrying the error message and status payload', async () => {
      const http = new HttpException(
        { message: 'Class not found', error: 'Not Found' },
        HttpStatus.NOT_FOUND,
      );

      await expect(
        lastValueFrom(
          interceptor.intercept(rpcContext({ data: { id: 'k9' } }), {
            handle: () => throwError(() => http),
          }),
        ),
      ).rejects.toBe(http);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[RPC ERROR] some.pattern'));
      expect(sink).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'RPC',
          requestBody: JSON.stringify({ id: 'k9' }),
          errorMessage: http.message,
          responseBody: JSON.stringify({
            statusCode: 404,
            message: 'Class not found',
            error: 'Not Found',
          }),
        }),
      );
    });

    it('wraps a string response of an HttpException as the message', async () => {
      const http = new HttpException('Plain failure', HttpStatus.BAD_REQUEST);

      await expect(
        lastValueFrom(
          interceptor.intercept(rpcContext(), { handle: () => throwError(() => http) }),
        ),
      ).rejects.toBe(http);

      expect(JSON.parse(sink.mock.calls[0][0].responseBody as string)).toEqual({
        statusCode: 400,
        message: 'Plain failure',
      });
    });

    it('describes a plain Error by name and message', async () => {
      const plain = new TypeError('bad type');

      await expect(
        lastValueFrom(
          interceptor.intercept(rpcContext(), { handle: () => throwError(() => plain) }),
        ),
      ).rejects.toBe(plain);

      expect(JSON.parse(sink.mock.calls[0][0].responseBody as string)).toEqual({
        name: 'TypeError',
        message: 'bad type',
      });
    });

    it('records non-Error throws as their raw value', async () => {
      await expect(
        lastValueFrom(
          interceptor.intercept(rpcContext(), { handle: () => throwError(() => 'string failure') }),
        ),
      ).rejects.toBe('string failure');

      expect(sink.mock.calls[0][0].errorMessage).toBe('string failure');
      expect(sink.mock.calls[0][0].responseBody).toBe('"string failure"');
    });

    it('does not emit an error entry for log.* patterns but still re-throws', async () => {
      const boom = new Error('log failure');

      await expect(
        lastValueFrom(
          interceptor.intercept(rpcContext({ pattern: 'log.write' }), {
            handle: () => throwError(() => boom),
          }),
        ),
      ).rejects.toBe(boom);

      expect(sink).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('omits statusCode when the error has getResponse but no getStatus', async () => {
      const err = { getResponse: () => ({ message: 'no status here' }) };

      await expect(
        lastValueFrom(interceptor.intercept(rpcContext(), { handle: () => throwError(() => err) })),
      ).rejects.toBe(err);

      expect(JSON.parse(sink.mock.calls[0][0].responseBody as string)).toEqual({
        message: 'no status here',
      });
    });

    it('leaves responseBody undefined when the error payload cannot be serialized', async () => {
      const err = { big: BigInt(1) };

      await expect(
        lastValueFrom(interceptor.intercept(rpcContext(), { handle: () => throwError(() => err) })),
      ).rejects.toBe(err);

      expect(sink.mock.calls[0][0].responseBody).toBeUndefined();
      expect(sink.mock.calls[0][0].errorMessage).toBe('[object Object]');
    });
  });

  describe('error preview truncation', () => {
    it('truncates an oversized error payload to 1000 characters with a marker', async () => {
      const err = new Error('x'.repeat(1500));

      await expect(
        lastValueFrom(interceptor.intercept(rpcContext(), { handle: () => throwError(() => err) })),
      ).rejects.toBe(err);

      const body = sink.mock.calls[0][0].responseBody as string;
      expect(body.endsWith('…(truncated)')).toBe(true);
      expect(body.length).toBe(1000 + '…(truncated)'.length);
    });
  });

  describe('response preview', () => {
    it('leaves responseBody undefined when the handler response cannot be serialized', async () => {
      const result = await lastValueFrom(
        interceptor.intercept(rpcContext(), handlerReturning({ big: BigInt(2) })),
      );

      expect(result).toEqual({ big: BigInt(2) });
      expect(sink.mock.calls[0][0].responseBody).toBeUndefined();
    });
  });
});

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
    expect(resolveServiceHost()).toBe('tutor-service:4002');
  });

  it('falls back to the default port 8888 when PORT is unset', () => {
    delete process.env.SERVICE_HOST;
    delete process.env.PORT;
    expect(resolveServiceHost()).toBe('tutor-service:8888');
  });

  it('treats an empty SERVICE_HOST as unset', () => {
    process.env.SERVICE_HOST = '';
    process.env.PORT = '5000';
    expect(resolveServiceHost()).toBe('tutor-service:5000');
  });

  it('includes host in the emitted log entry', async () => {
    process.env.SERVICE_HOST = 'svc:50051';
    const spy = jest.fn<unknown, [RequestLogEntry]>();
    setLogSink(spy);
    await lastValueFrom(
      new TraceContextInterceptor().intercept(
        rpcContext({ pattern: 'some.pattern' }),
        handlerReturning('ok'),
      ),
    );
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ host: 'svc:50051', type: 'RPC' }));
  });
});
