import { DEV_CORS_ORIGINS, resolveCorsOrigins } from 'src/packages/helpers/cors.helper';

describe('resolveCorsOrigins', () => {
  it('uses the CORS_ORIGINS allowlist when set (trimmed, empty entries dropped)', () => {
    expect(
      resolveCorsOrigins({ CORS_ORIGINS: ' https://app.example.com , ,https://admin.example.com' }),
    ).toEqual(['https://app.example.com', 'https://admin.example.com']);
  });

  it('uses the localhost dev origins outside production when no allowlist is configured', () => {
    expect(resolveCorsOrigins({ NODE_ENV: 'development' })).toEqual(DEV_CORS_ORIGINS);
    expect(resolveCorsOrigins({})).toEqual(DEV_CORS_ORIGINS);
  });

  it('never reflects every origin (true) when no allowlist is configured', () => {
    expect(resolveCorsOrigins({ NODE_ENV: 'development' })).not.toBe(true);
    expect(resolveCorsOrigins({})).not.toBe(true);
    expect(DEV_CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
  });

  it('refuses to start in production when CORS_ORIGINS is missing', () => {
    expect(() => resolveCorsOrigins({ NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS/);
    expect(() => resolveCorsOrigins({ NODE_ENV: 'production', CORS_ORIGINS: ' , ' })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it('uses the allowlist in production when CORS_ORIGINS is set', () => {
    expect(
      resolveCorsOrigins({ NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example.com' }),
    ).toEqual(['https://app.example.com']);
  });
});
