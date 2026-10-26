import { ArgumentsHost, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { RpcExceptionFilter } from '@packages/filters/rpc-exception.filter';

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('Invalid `prisma.x.create()` invocation: secret sql', {
    code,
    clientVersion: 'test',
  });

const run = (exception: unknown) =>
  firstValueFrom(new RpcExceptionFilter().catch(exception, {} as ArgumentsHost)).catch(
    (payload: unknown) => payload,
  );

describe('RpcExceptionFilter — Prisma errors', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['P2002', 409, 'Record already exists'],
    ['P2003', 400, 'Referenced record does not exist'],
    ['P2023', 400, 'Invalid input format'],
  ])('maps %s to %i with a fixed message', async (code, statusCode, message) => {
    await expect(run(prismaError(code))).resolves.toEqual(
      expect.objectContaining({ statusCode, message, serviceName: 'tutor-service' }),
    );
  });

  it('still maps raw Postgres SQLSTATE codes', async () => {
    await expect(run(Object.assign(new Error('x'), { code: '23505' }))).resolves.toEqual(
      expect.objectContaining({ statusCode: 409 }),
    );
  });

  it('hides the details of an unmapped Prisma error behind a 500', async () => {
    const payload = (await run(prismaError('P2999'))) as { statusCode: number; message: string };

    expect(payload.statusCode).toBe(500);
    expect(payload.message).toBe('Internal server error');
    expect(JSON.stringify(payload)).not.toContain('secret sql');
  });
});
