import { ConfigService } from '@nestjs/config';
import { validateRequiredEnvs } from '@packages/helpers/checkEnv.helper';

const configWith = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('validateRequiredEnvs', () => {
  it('returns true when every required variable has a value', () => {
    const config = configWith({ A: 'a', B: 'b' });

    expect(validateRequiredEnvs(config, ['A', 'B'])).toBe(true);
  });

  it('returns true for an empty requirement list', () => {
    expect(validateRequiredEnvs(configWith({}), [])).toBe(true);
  });

  it('throws listing every missing variable in order', () => {
    const config = configWith({ A: 'a' });

    expect(() => validateRequiredEnvs(config, ['A', 'B', 'C'])).toThrow(
      'Missing required environment variables:\n- B\n- C',
    );
  });

  it.each([
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace only', '   \t'],
  ])('treats a %s value as missing', (_label, value) => {
    const config = configWith({ KEY: value });

    expect(() => validateRequiredEnvs(config, ['KEY'])).toThrow('- KEY');
  });

  it('keeps a value that only has surrounding whitespace around real content', () => {
    const config = configWith({ KEY: '  value  ' });

    expect(validateRequiredEnvs(config, ['KEY'])).toBe(true);
  });
});
