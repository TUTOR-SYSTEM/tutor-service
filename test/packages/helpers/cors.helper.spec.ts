import { resolveCorsOrigins } from 'src/packages/helpers/cors.helper';

describe('resolveCorsOrigins', () => {
  it('uses the CORS_ORIGINS allowlist when set (trimmed, empty entries dropped)', () => {
    expect(
      resolveCorsOrigins({ CORS_ORIGINS: ' https://app.example.com , ,https://admin.example.com' }),
    ).toEqual(['https://app.example.com', 'https://admin.example.com']);
  });

  it('reflects any origin outside production when no allowlist is configured', () => {
    expect(resolveCorsOrigins({ NODE_ENV: 'development' })).toBe(true);
  });

  it('denies cross-origin requests in production when no allowlist is configured', () => {
    expect(resolveCorsOrigins({ NODE_ENV: 'production' })).toBe(false);
  });
});
