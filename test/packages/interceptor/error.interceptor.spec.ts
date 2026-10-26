import {
  CallHandler,
  ExecutionContext,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { firstValueFrom, throwError } from 'rxjs';
import { ErrorInterceptor } from '@packages/interceptor/error.interceptor';

const intercept = (error: unknown) =>
  firstValueFrom(
    new ErrorInterceptor().intercept(
      {} as ExecutionContext,
      {
        handle: () => throwError(() => error),
      } as CallHandler,
    ),
  ).catch((e: unknown) => e as InternalServerErrorException);

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('Invalid `prisma.x.create()` invocation: secret sql', {
    code,
    clientVersion: 'test',
  });

describe('ErrorInterceptor — database errors', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['P2003', 'Referenced record not found (foreign key violation)'],
    ['P2002', 'Record already exists (duplicate value)'],
    ['P2011', 'Required field is missing (not-null violation)'],
    ['23505', 'Record already exists (duplicate value)'],
  ])('translates %s into a client-safe message', async (code, message) => {
    const error = await intercept(code.startsWith('P') ? prismaError(code) : { code });

    expect(error.message).toBe(message);
  });

  it('never forwards Prisma invocation details', async () => {
    const error = await intercept(prismaError('P2025'));

    expect(error.message).toBe('Database error');
  });

  it('passes ordinary error messages through', async () => {
    const error = await intercept(new Error('plain failure'));

    expect(error.message).toBe('plain failure');
  });
});
