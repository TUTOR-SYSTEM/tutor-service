#!/usr/bin/env bun
/**
 * Drop all tables + enums, recreate from schema, seed test users.
 *
 * DESTRUCTIVE: drops every table in the `public` schema, which is shared by all 4 services.
 * Refuses to run when NODE_ENV=production, and requires the exact database name as a
 * confirmation flag so a run against the wrong DB cannot happen by accident.
 *
 * Usage: bun scripts/recreate-db.ts --confirm=<database name>
 */
import 'dotenv/config';
import { createPrisma } from './lib/prisma';
import { execSync } from 'node:child_process';

function resolveDatabaseUrl(): string {
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

/** Database name from the URL (never the URL itself: it carries the password). */
function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

function assertSafeToRecreate(url: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('recreate-db refuses to run when NODE_ENV=production');
  }
  const dbName = databaseName(url);
  const confirmArg = process.argv.find((arg) => arg.startsWith('--confirm='));
  const confirmed = confirmArg?.slice('--confirm='.length);
  if (!dbName || confirmed !== dbName) {
    throw new Error(
      `recreate-db drops all tables. Re-run with --confirm=${dbName || '<database name>'} to proceed`,
    );
  }
}

async function main(): Promise<void> {
  const url = resolveDatabaseUrl();
  assertSafeToRecreate(url);
  console.log(`Recreating database "${databaseName(url)}"…`);
  const prisma = createPrisma();

  console.log('Dropping all tables…');
  // Drop tables with CASCADE to remove FK dependencies
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;
  for (const t of tables) {
    // identifiers come from pg_tables, never from user input
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${t.tablename}" CASCADE`);
  }
  console.log(`  Dropped ${tables.length} table(s)`);

  // Drop all custom enum types
  const enums = await prisma.$queryRaw<Array<{ typname: string }>>`
    SELECT t.typname
    FROM pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
  `;
  for (const e of enums) {
    await prisma.$executeRawUnsafe(`DROP TYPE IF EXISTS "${e.typname}" CASCADE`);
  }
  console.log(`  Dropped ${enums.length} enum(s)`);

  await prisma.$disconnect();

  // Recreate the schema from the Prisma migrations
  console.log('\nApplying Prisma migrations…');
  execSync('bunx prisma migrate deploy', {
    stdio: 'inherit',
  });

  // Seed users
  console.log('\nSeeding users…');
  execSync('bun scripts/seed-user.ts', {
    stdio: 'inherit',
  });

  console.log('\nDone. Database recreated and seeded.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
