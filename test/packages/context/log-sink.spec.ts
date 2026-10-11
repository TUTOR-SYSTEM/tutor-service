import { emitRequestLog, RequestLogEntry, setLogSink } from '@packages/context/log-sink';

const entry = {
  serviceName: 'tutor-service',
  host: 'tutor-service:8888',
  type: 'RPC',
  path: 'class.create',
  durationMs: 5,
  correlationId: 'c-1',
  traceId: 't-1',
} as RequestLogEntry;

describe('log-sink', () => {
  afterEach(() => {
    // reset module-level sink so tests stay independent
    setLogSink(undefined as unknown as (e: RequestLogEntry) => unknown);
  });

  it('does nothing when no sink has been registered', () => {
    expect(() => emitRequestLog(entry)).not.toThrow();
  });

  it('forwards the entry to the registered sink', () => {
    const sink = jest.fn();
    setLogSink(sink);

    emitRequestLog(entry);

    expect(sink).toHaveBeenCalledWith(entry);
  });

  it('swallows a synchronous sink error so the request is not affected', () => {
    setLogSink(() => {
      throw new Error('sink exploded');
    });

    expect(() => emitRequestLog(entry)).not.toThrow();
  });

  it('swallows a rejected promise returned by the sink', async () => {
    setLogSink(() => Promise.reject(new Error('async sink exploded')));

    expect(() => emitRequestLog(entry)).not.toThrow();
    // let the attached .catch handler run; an unhandled rejection would fail the test run
    await new Promise((resolve) => setImmediate(resolve));
  });
});
