import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ClientProxy, RmqRecord } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { randomUUID } from 'node:crypto';
import {
  CORRELATION_ID_HEADER,
  getRequestContext,
  PARENT_TRACE_ID_HEADER,
  SERVICE_NAME_HEADER,
  TRACE_ID_HEADER,
} from '@packages/context/request-context';
import {
  resolveRmqTarget,
  RmqTarget,
  THIRD_SERVICE,
  TUTOR_SERVICE,
  USER_SERVICE,
} from './rmq.constants';

const SERVICE_NAME = 'tutor-service';

/**
 * Wraps the payload in an `RmqRecord` so the trace headers ride as AMQP message headers
 * (`properties.headers`) instead of changing the payload any `@Payload()` handler receives.
 * `correlationId` is reused from the current `RequestContext` for the whole distributed flow,
 * a fresh `traceId` identifies this hop, and `parentTraceId` links back to the hop that triggered it.
 */
function withTraceHeaders<T>(message: T): {
  record: RmqRecord<T>;
  headers: Record<string, string>;
} {
  const ctx = getRequestContext();
  const headers = {
    [CORRELATION_ID_HEADER]: ctx?.correlationId ?? randomUUID(),
    [TRACE_ID_HEADER]: randomUUID(),
    [PARENT_TRACE_ID_HEADER]: ctx?.traceId ?? '',
    [SERVICE_NAME_HEADER]: SERVICE_NAME,
  };
  return { record: new RmqRecord<T>(message, { headers }), headers };
}

interface RpcErrorPayload {
  statusCode?: number;
  message?: string | string[];
  errors?: unknown;
  serviceName?: string;
}

function toRpcErrorPayload(raw: unknown): RpcErrorPayload {
  if (typeof raw === 'object' && raw !== null && !(raw instanceof Error)) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.message === 'string' || Array.isArray(obj.message)) {
      return obj;
    }
    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: JSON.stringify(obj) };
  }
  const message = raw instanceof Error ? raw.message : String(raw);
  return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message };
}

/** Lets tutor-service call out to another service — currently just `log.create` (fire-and-forget) to third-service. */
@Injectable()
export class RmqProducer implements OnModuleDestroy {
  private readonly logger = new Logger(RmqProducer.name);
  private readonly clients: Record<RmqTarget, ClientProxy>;

  constructor(
    @Inject(USER_SERVICE) userClient: ClientProxy,
    @Inject(TUTOR_SERVICE) tutorClient: ClientProxy,
    @Inject(THIRD_SERVICE) thirdClient: ClientProxy,
  ) {
    this.clients = {
      [USER_SERVICE]: userClient,
      [TUTOR_SERVICE]: tutorClient,
      [THIRD_SERVICE]: thirdClient,
    };

    this.logger.log(
      `✅ RabbitMQ clients initialized: ${[USER_SERVICE, TUTOR_SERVICE, THIRD_SERVICE].join(', ')}`,
    );
  }

  async onModuleDestroy() {
    await Promise.all(Object.values(this.clients).map((client) => client.close() as Promise<void>));
  }

  emit<TResult = unknown, TInput = unknown>(pattern: string, message: TInput): Promise<TResult> {
    const client = this.clients[resolveRmqTarget(pattern)];
    const { record, headers } = withTraceHeaders(message);
    this.logger.log(
      `[EMIT] ${pattern} correlationId=${headers[CORRELATION_ID_HEADER]} traceId=${headers[TRACE_ID_HEADER]}`,
    );
    return firstValueFrom(client.emit<TResult, RmqRecord<TInput>>(pattern, record), {
      defaultValue: undefined as TResult,
    });
  }

  /**
   * Request-reply with per-attempt timeout and exponential backoff. Rethrows whatever the
   * responder's `RpcExceptionFilter` produced as an `HttpException` with the original status.
   */
  async send<TResponse, TRequest>(
    pattern: string,
    message: TRequest,
    timeoutMs?: number,
    maxRetries: number = 2,
  ): Promise<TResponse> {
    const client = this.clients[resolveRmqTarget(pattern)];
    const { record, headers } = withTraceHeaders(message);
    const correlationId = headers[CORRELATION_ID_HEADER];
    const traceId = headers[TRACE_ID_HEADER];
    const finalTimeoutMs = timeoutMs ?? 10000;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await firstValueFrom(
          client
            .send<TResponse, RmqRecord<TRequest>>(pattern, record)
            .pipe(timeout({ each: finalTimeoutMs })),
        );
      } catch (error: unknown) {
        const isTimeout = error instanceof Error && error.name === 'TimeoutError';
        const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);

        this.logger.warn(
          `[SEND-ATTEMPT-FAILED] ${pattern} correlationId=${correlationId} traceId=${traceId} attempt=${attempt} isTimeout=${isTimeout} error=${errorMessage}`,
        );

        if (attempt === maxRetries + 1) {
          const payload = toRpcErrorPayload(error);
          throw new HttpException(
            {
              message: payload.message ?? 'Message queue service unavailable',
              errors: payload.errors,
              serviceName: payload.serviceName,
              isTimeout,
            },
            isTimeout
              ? HttpStatus.GATEWAY_TIMEOUT
              : (payload.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR),
          );
        }

        const backoffMs = Math.min(100 * Math.pow(2, attempt - 1), 5000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw new HttpException(
      'Message queue request failed unexpectedly',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
