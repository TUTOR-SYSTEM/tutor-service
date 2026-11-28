/**
 * Swagger UI and OpenAPI JSON are served outside production, and in production only when
 * `SWAGGER_ENABLED=true` is set explicitly.
 */
export function isSwaggerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== 'production') return true;
  return env.SWAGGER_ENABLED?.trim().toLowerCase() === 'true';
}
