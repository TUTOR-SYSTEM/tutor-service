import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/** `DATABASE_URL`, or a URL assembled from `POSTGRES_*` (defaults match docker-compose). */
export function resolveDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) return databaseUrl;

  const host = process.env.POSTGRES_HOST?.trim() || 'localhost';
  const port = process.env.POSTGRES_PORT?.trim() || '5433';
  const db = process.env.POSTGRES_DB?.trim() || 'backends_db';
  const user = process.env.POSTGRES_USER?.trim() || 'postgres';
  const password = process.env.POSTGRES_PASSWORD?.trim() || 'postgres';

  const url = new URL(`postgres://${host}:${port}/${db}`);
  url.username = user;
  url.password = password;
  return url.toString();
}

export function createPrisma(): PrismaClient {
  return new PrismaClient({ datasourceUrl: resolveDatabaseUrl() });
}
