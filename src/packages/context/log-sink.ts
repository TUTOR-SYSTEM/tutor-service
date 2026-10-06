/**
 * Lets `TraceContextInterceptor` ship a request-log row without needing DI — it's instantiated
 * with `new` in `main.ts`, before the Nest DI container exists, so it can't constructor-inject
 * `RmqProducer` directly. `main.ts` calls `setLogSink(...)` once, right after building the app,
 * wiring the emit to `third-service`'s `request_logs` table over RabbitMQ (`log.create`, fire-
 * and-forget); every interceptor call after that just fires into whatever sink was registered.
 * Mirrors the `request-context.ts` pattern of a plain module-level utility reachable from
 * manually-instantiated interceptors.
 */
export interface RequestLogEntry {
  serviceName: string;
  /** Service address (e.g. `user-service:50051`), from `SERVICE_HOST` or `${SERVICE_NAME}:${PORT}`. */
  host?: string;
  type: 'HTTP' | 'RPC';
  method?: string;
  path: string;
  statusCode?: number;
  durationMs: number;
  correlationId: string;
  traceId: string;
  parentTraceId?: string;
  userId?: string;
  ip?: string;
  requestBody?: string;
  responseBody?: string;
  errorMessage?: string;
}

type LogSinkFn = (entry: RequestLogEntry) => unknown;

let sink: LogSinkFn | undefined;

export function setLogSink(fn: LogSinkFn): void {
  sink = fn;
}

/** Fire-and-forget — never lets a logging failure affect the request it's logging. */
export function emitRequestLog(entry: RequestLogEntry): void {
  if (!sink) return;
  try {
    Promise.resolve(sink(entry)).catch(() => {});
  } catch {
    // swallow — logging must never break the request path
  }
}
