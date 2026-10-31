import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';

import { validateRequiredEnvs } from '@packages/helpers';

export const DATABASE_ENVS = [
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
] as const;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/** `DATABASE_URL`, or a URL assembled from the `POSTGRES_*` variables. */
export function resolveDatabaseUrl(configService: ConfigService): string {
  const databaseUrl = configService.get<string>('DATABASE_URL')?.trim();
  if (databaseUrl) return databaseUrl;

  validateRequiredEnvs(configService, DATABASE_ENVS);
  const url = new URL(
    `postgres://${configService.getOrThrow('POSTGRES_HOST')}:${configService.getOrThrow(
      'POSTGRES_PORT',
    )}/${configService.getOrThrow('POSTGRES_DB')}`,
  );
  url.username = configService.getOrThrow('POSTGRES_USER');
  url.password = configService.getOrThrow('POSTGRES_PASSWORD');
  return url.toString();
}

/**
 * `a, b, c` as bound `uuid` parameters for a raw `IN (...)` — Prisma binds JS strings as `text`,
 * which Postgres will not compare against a `uuid` column without the cast.
 */
export function uuidList(ids: readonly string[]): Prisma.Sql {
  return Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
}

/** True when a Prisma call failed because the targeted row does not exist (P2025). */
export function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(configService: ConfigService) {
    super({ datasourceUrl: resolveDatabaseUrl(configService) });
  }

  async onModuleInit() {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // never log the connection string: DATABASE_URL carries the Postgres password
        await this.$connect();
        this.logger.log('✅ PostgreSQL connected.');
        return;
      } catch (error) {
        this.logger.warn(
          `PostgreSQL connection attempt ${attempt}/${MAX_RETRIES} failed: ${
            (error as Error).message
          }`,
        );

        if (attempt === MAX_RETRIES) {
          this.logger.error('❌ PostgreSQL connect failed.');
          throw new Error('PostgreSQL connect failed');
        }

        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
