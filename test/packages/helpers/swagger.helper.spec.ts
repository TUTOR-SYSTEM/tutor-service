import { isSwaggerEnabled } from 'src/packages/helpers/swagger.helper';

describe('isSwaggerEnabled', () => {
  it.each([{ NODE_ENV: 'development' }, { NODE_ENV: 'test' }, {}])(
    'is enabled outside production (%j)',
    (env) => {
      expect(isSwaggerEnabled(env)).toBe(true);
    },
  );

  it('is disabled in production by default', () => {
    expect(isSwaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it.each(['true', 'TRUE', ' true '])('is enabled in production with SWAGGER_ENABLED=%j', (v) => {
    expect(isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: v })).toBe(true);
  });

  it.each(['false', '1', 'yes', ''])(
    'stays disabled in production with SWAGGER_ENABLED=%j',
    (v) => {
      expect(isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: v })).toBe(false);
    },
  );
});
