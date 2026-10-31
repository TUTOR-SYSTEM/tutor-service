import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { catchError, Observable, throwError } from 'rxjs';

@Injectable()
export class ErrorInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ErrorInterceptor.name);

  private resolveClientMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null) {
      const e = error as Record<string, unknown>;
      const pgCode = (e.code ?? (e.cause as Record<string, unknown> | undefined)?.code) as
        string | undefined;
      switch (pgCode) {
        case '23503':
        case 'P2003':
          return 'Referenced record not found (foreign key violation)';
        case '23505':
        case 'P2002':
          return 'Record already exists (duplicate value)';
        case '23502':
        case 'P2011':
          return 'Required field is missing (not-null violation)';
        case '23514':
          return 'Value violates check constraint';
      }
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    // Prisma messages embed the failing invocation (model, arguments) — never send them out
    return message.startsWith('Failed query:') || message.includes('`prisma.')
      ? 'Database error'
      : message;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof HttpException) {
          return throwError(() => error);
        }

        const isError = error instanceof Error;
        const originalMessage = isError ? error.message : 'Internal server error';
        const originalStack = isError ? error.stack : undefined;

        this.logger.error(originalMessage, originalStack);

        const clientMessage = this.resolveClientMessage(error);
        const exception = new InternalServerErrorException(clientMessage);
        if (originalStack) exception.stack = originalStack;

        return throwError(() => exception);
      }),
    );
  }
}
