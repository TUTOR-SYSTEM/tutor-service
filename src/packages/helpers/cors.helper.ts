/**
 * Resolve the CORS `origin` option from env (same rule as third-service).
 * - `CORS_ORIGINS` (comma separated) set -> allowlist.
 * - otherwise `true` outside production, `false` in production.
 */
export function resolveCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] | boolean {
  const list = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (list.length > 0) {
    return list;
  }
  return env.NODE_ENV !== 'production';
}
