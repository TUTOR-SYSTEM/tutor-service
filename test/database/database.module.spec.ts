import { Logger, Provider } from '@nestjs/common';
import { GLOBAL_MODULE_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { DATABASE_ENVS, DatabaseModule, DRIZZLE } from 'src/database/database.module';

jest.mock('postgres', () => jest.fn());
jest.mock('drizzle-orm/postgres-js', () => ({ drizzle: jest.fn() }));

const postgresMock = postgres as unknown as jest.Mock;
const drizzleMock = drizzle as unknown as jest.Mock;

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

function getDrizzleProvider(): Provider & {
  useFactory: (config: ConfigService) => Promise<unknown>;
} {
  const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, DatabaseModule) as Provider[];
  const provider = providers.find(
    (item): item is Provider & { useFactory: never } =>
      typeof item === 'object' && 'provide' in item && item.provide === DRIZZLE,
  );
  if (!provider) throw new Error('DRIZZLE provider not found');
  return provider as Provider & { useFactory: (config: ConfigService) => Promise<unknown> };
}

describe('DatabaseModule', () => {
  let clientSql: jest.Mock;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    clientSql = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    postgresMock.mockReset().mockReturnValue(clientSql);
    drizzleMock.mockReset().mockImplementation((_client, options) => ({ built: true, options }));
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is a global module that exports the DRIZZLE token', () => {
    expect(Reflect.getMetadata(GLOBAL_MODULE_METADATA, DatabaseModule)).toBe(true);
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, DatabaseModule)).toContain(DRIZZLE);
  });

  it('lists the individual POSTGRES_* variables as the required env set', () => {
    expect(DATABASE_ENVS).toEqual([
      'POSTGRES_HOST',
      'POSTGRES_PORT',
      'POSTGRES_DB',
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
    ]);
  });

  it('connects with DATABASE_URL when it is set, without checking the split variables', async () => {
    const factory = getDrizzleProvider().useFactory;
    const config = makeConfig({ DATABASE_URL: '  postgres://u:p@db:5432/app  ' });

    const db = await factory(config);

    expect(postgresMock).toHaveBeenCalledWith('postgres://u:p@db:5432/app');
    expect(clientSql).toHaveBeenCalledTimes(1);
    expect(db).toEqual({
      built: true,
      options: { schema: expect.not.objectContaining({ default: expect.anything() }) },
    });
    expect(drizzleMock).toHaveBeenCalledWith(clientSql, expect.any(Object));
  });

  it('builds the connection string from POSTGRES_* variables when DATABASE_URL is blank', async () => {
    const factory = getDrizzleProvider().useFactory;
    const config = makeConfig({
      DATABASE_URL: '   ',
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: '5433',
      POSTGRES_DB: 'tutor',
      POSTGRES_USER: 'tutor user',
      POSTGRES_PASSWORD: 'p@ss',
    });

    await factory(config);

    expect(postgresMock).toHaveBeenCalledWith(
      'postgres://tutor%20user:p%40ss@localhost:5433/tutor',
    );
  });

  it('throws a validation error listing every missing POSTGRES_* variable when no URL is given', async () => {
    const factory = getDrizzleProvider().useFactory;

    await expect(factory(makeConfig({ POSTGRES_HOST: 'localhost' }))).rejects.toThrow(
      'Missing required environment variables:\n- POSTGRES_PORT\n- POSTGRES_DB\n- POSTGRES_USER\n- POSTGRES_PASSWORD',
    );
    expect(postgresMock).not.toHaveBeenCalled();
  });

  it('retries the connection after a failure and succeeds on a later attempt', async () => {
    const factory = getDrizzleProvider().useFactory;
    clientSql
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce([{ '?column?': 1 }]);
    const timeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => {
      cb();
      return 0;
    }) as unknown as typeof setTimeout);

    const db = await factory(makeConfig({ DATABASE_URL: 'postgres://x' }));

    expect(clientSql).toHaveBeenCalledTimes(2);
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('attempt 1/3 failed: ECONNREFUSED'),
    );
    expect(db).toEqual(expect.objectContaining({ built: true }));
  });

  it('gives up after three failed attempts and throws a generic connection error', async () => {
    const factory = getDrizzleProvider().useFactory;
    clientSql.mockRejectedValue(new Error('auth failed'));
    const timeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => {
      cb();
      return 0;
    }) as unknown as typeof setTimeout);

    await expect(factory(makeConfig({ DATABASE_URL: 'postgres://x' }))).rejects.toThrow(
      'PostgreSQL connect failed',
    );

    expect(clientSql).toHaveBeenCalledTimes(3);
    // the delay is only scheduled between attempts, never after the final one
    expect(timeoutSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(warnSpy).toHaveBeenLastCalledWith(
      expect.stringContaining('attempt 3/3 failed: auth failed'),
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('PostgreSQL connect failed'));
  });
});
