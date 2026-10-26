import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { throwError } from 'rxjs';

const SERVICE_NAME = 'tutor-service';

/**
 * Postgres SQLSTATE codes that mean the caller sent bad data (not a server fault). Mapped to a
 * 4xx with a fixed message so the raw SQL/driver text never reaches the client.
 */
const PG_CLIENT_ERRORS: Record<string, { status: number; message: string }> = {
  '22P02': { status: HttpStatus.BAD_REQUEST, message: 'Invalid input format' },
  '23503': { status: HttpStatus.BAD_REQUEST, message: 'Referenced record does not exist' },
  '23505': { status: HttpStatus.CONFLICT, message: 'Record already exists' },
};

const logger = new Logger('RpcExceptionFilter');

/**
 * Prisma reports constraint failures with its own `P2xxx` codes; translate them to the SQLSTATE
 * equivalents above so one table drives the 4xx mapping.
 */
const PRISMA_TO_PG: Record<string, string> = {
  P2002: '23505', // unique constraint
  P2003: '23503', // foreign key constraint
  P2023: '22P02', // malformed value (e.g. a non-UUID id)
};

/** A 5-char SQLSTATE (also looked up on `cause`), or the SQLSTATE a Prisma error code maps to. */
function pgErrorCode(exception: unknown): string | undefined {
  for (const candidate of [exception, (exception as { cause?: unknown })?.cause]) {
    const code = (candidate as { code?: unknown } | undefined)?.code;
    if (typeof code !== 'string') continue;
    if (PRISMA_TO_PG[code]) return PRISMA_TO_PG[code];
    if (/^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

export interface RpcErrorPayload {
  statusCode: number;
  message: string | string[];
  errors?: unknown;
  /** Which service actually threw — preserved as-is when relaying another service's error. */
  serviceName: string;
}

/**
 * Registered as a *microservice-scoped* global filter in `main.ts`
 * (`rmqMicroservice.useGlobalFilters(...)`) — every `@MessagePattern` handler gets it
 * automatically, no per-controller `@UseFilters(RpcExceptionFilter)` needed. It is never passed
 * to `app.useGlobalFilters()` on the main HTTP `app`, so the HTTP side keeps using
 * `HttpExceptionFilter` untouched (this filter reads an RPC context, not an Express `Response`).
 * The gateway's `ClientRMQ` has no notion of `HttpException`; this normalizes whatever a
 * message-pattern handler throws into a plain, JSON-serializable error object the caller's
 * `RmqProducer.send` helper can turn back into the right `HttpException`.
 */
@Catch()
export class RpcExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, _host: ArgumentsHost) {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] })?.message ?? exception.message);
      const errors =
        typeof response === 'object' ? (response as { errors?: unknown }).errors : undefined;
      // If this exception is `RmqProducer.send()` rethrowing another service's error, its
      // response body already carries the origin's `serviceName` — preserve it instead of
      // overwriting with our own.
      const serviceName =
        typeof response === 'object'
          ? ((response as { serviceName?: string }).serviceName ?? SERVICE_NAME)
          : SERVICE_NAME;

      return throwError(
        () => ({ statusCode: status, message, errors, serviceName }) satisfies RpcErrorPayload,
      );
    }

    const pgCode = pgErrorCode(exception);
    const mapped = pgCode ? PG_CLIENT_ERRORS[pgCode] : undefined;
    if (mapped) {
      return throwError(
        () =>
          ({
            statusCode: mapped.status,
            message: mapped.message,
            serviceName: SERVICE_NAME,
          }) satisfies RpcErrorPayload,
      );
    }

    // unexpected failure: keep the detail (SQL, parameters) in the server log only
    logger.error(
      `Unhandled RPC error${pgCode ? ` (pg ${pgCode})` : ''}`,
      exception instanceof Error ? exception.stack : undefined,
    );
    return throwError(
      () =>
        ({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
          serviceName: SERVICE_NAME,
        }) satisfies RpcErrorPayload,
    );
  }
}
