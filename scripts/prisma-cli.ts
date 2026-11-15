/**
 * Runs the Prisma CLI with DATABASE_URL resolved the same way the app does:
 * DATABASE_URL, else built from the discrete POSTGRES_* vars (bun auto-loads .env).
 * Usage: bun scripts/prisma-cli.ts <prisma args...>
 */
const env = { ...process.env };
if (!env.DATABASE_URL?.trim()) {
  const { POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD } = env;
  if (!POSTGRES_HOST || !POSTGRES_DB) {
    console.error('Missing DATABASE_URL and POSTGRES_HOST/POSTGRES_DB in env (.env).');
    process.exit(1);
  }
  env.DATABASE_URL = `postgresql://${encodeURIComponent(POSTGRES_USER ?? '')}:${encodeURIComponent(
    POSTGRES_PASSWORD ?? '',
  )}@${POSTGRES_HOST}:${POSTGRES_PORT ?? 5432}/${POSTGRES_DB}`;
}
const proc = Bun.spawn(['bunx', 'prisma', ...process.argv.slice(2)], {
  env,
  stdio: ['inherit', 'inherit', 'inherit'],
});
process.exit(await proc.exited);
