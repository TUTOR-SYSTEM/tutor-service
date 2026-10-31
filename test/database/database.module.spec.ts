import { Logger } from '@nestjs/common';
import { GLOBAL_MODULE_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { DatabaseModule } from 'src/database/database.module';
import { isRecordNotFound, PrismaService, resolveDatabaseUrl } from 'src/database/prisma.service';

type Env = Record<string, string | undefined>;

function makeConfig(env: Env): ConfigService {
  return {
    get: (key: string) => env[key],
    getOrThrow: (key: string) => {
      const value = env[key];
      if (value === undefined) throw new Error(`Missing ${key}`);
      return value;
    },
  } as unknown as ConfigService;
}

const POSTGRES_ENV = {
  POSTGRES_HOST: 'db.internal',
  POSTGRES_PORT: '5432',
  POSTGRES_DB: 'tutor',
  POSTGRES_USER: 'app',
  POSTGRES_PASSWORD: 'p@ss/word',
};

describe('DatabaseModule', () => {
  it('is a global module that provides and exports PrismaService', () => {
    expect(Reflect.getMetadata(GLOBAL_MODULE_METADATA, DatabaseModule)).toBe(true);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, DatabaseModule)).toContain(PrismaService);
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, DatabaseModule)).toContain(PrismaService);
  });
});

describe('resolveDatabaseUrl', () => {
  it('prefers DATABASE_URL (trimmed) over the POSTGRES_* variables', () => {
    const config = makeConfig({ DATABASE_URL: '  postgresql://u:p@h:5432/d  ', ...POSTGRES_ENV });

    expect(resolveDatabaseUrl(config)).toBe('postgresql://u:p@h:5432/d');
  });

  it('assembles a URL from POSTGRES_* and encodes the credentials', () => {
    const url = new URL(resolveDatabaseUrl(makeConfig(POSTGRES_ENV)));

    expect(url.hostname).toBe('db.internal');
    expect(url.port).toBe('5432');
    expect(url.pathname).toBe('/tutor');
    expect(url.username).toBe('app');
    expect(decodeURIComponent(url.password)).toBe('p@ss/word');
  });

  it('throws when neither DATABASE_URL nor the full POSTGRES_* set is configured', () => {
    expect(() => resolveDatabaseUrl(makeConfig({ POSTGRES_HOST: 'h' }))).toThrow();
  });
});

describe('PrismaService.onModuleInit', () => {
  let service: PrismaService;
  let connect: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new PrismaService(makeConfig({ DATABASE_URL: 'postgresql://u:secret@h:5432/d' }));
    connect = jest.spyOn(service, '$connect');
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('connects once when the database is reachable', async () => {
    connect.mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('retries a failed connection and succeeds on a later attempt', async () => {
    connect.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);

    const init = service.onModuleInit();
    await jest.advanceTimersByTimeAsync(2000);
    await init;

    expect(connect).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('attempt 1/3 failed: boom'));
  });

  it('gives up after 3 attempts without leaking the connection string', async () => {
    connect.mockRejectedValue(new Error('down'));

    const init = service.onModuleInit();
    const assertion = expect(init).rejects.toThrow('PostgreSQL connect failed');
    await jest.advanceTimersByTimeAsync(4000);
    await assertion;

    expect(connect).toHaveBeenCalledTimes(3);
    expect(errorSpy).toHaveBeenCalledWith('❌ PostgreSQL connect failed.');
    const logged = [...warnSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ');
    expect(logged).not.toContain('secret');
  });

  it('disconnects on module destroy', async () => {
    const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined);

    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('isRecordNotFound', () => {
  const known = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test' });

  it('is true only for Prisma P2025', () => {
    expect(isRecordNotFound(known('P2025'))).toBe(true);
    expect(isRecordNotFound(known('P2002'))).toBe(false);
    expect(isRecordNotFound(new Error('P2025'))).toBe(false);
  });
});
