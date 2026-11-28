/** Dev-only fallback when `CORS_ORIGINS` is unset: the Next.js UI's default dev server. */
export const DEV_CORS_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

/**
 * Resolve the CORS `origin` allowlist from env (same rule as the other services). Credentials are
 * always enabled, so the origin is never reflected: a wildcard/`true` is not returned.
 * - `CORS_ORIGINS` (comma separated) set -> that allowlist.
 * - unset outside production -> `DEV_CORS_ORIGINS`.
 * - unset in production -> throws, the app refuses to boot.
 */
export function resolveCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const list = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (list.length > 0) {
    return list;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('CORS_ORIGINS must be set in production (comma-separated origin allowlist)');
  }
  return [...DEV_CORS_ORIGINS];
}
