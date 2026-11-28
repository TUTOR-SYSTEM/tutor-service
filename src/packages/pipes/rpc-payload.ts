import type { ZodType } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

/**
 * Parses an RMQ message payload with the schema for its pattern. Same validation and error shape
 * as the HTTP `ZodValidationPipe`; a miss throws 422, which `RpcExceptionFilter` relays to the
 * gateway.
 */
export function parseRpcPayload<T>(schema: ZodType<T>, payload: unknown): T {
  return new ZodValidationPipe<T>(schema).transform(payload);
}
