import { ExecutionContext } from '@nestjs/common';
import { DEFAULT_LANGUAGE, LanguageGuard } from '@packages/guards/language.guard';

const contextWith = (headers: Record<string, string> = {}) => {
  const request: { headers: Record<string, string>; language?: string } = { headers };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
};

describe('LanguageGuard', () => {
  const guard = new LanguageGuard();

  it('defaults to vi when there is no accept-language header', () => {
    const { context, request } = contextWith();

    expect(guard.canActivate(context)).toBe(true);
    expect(request.language).toBe(DEFAULT_LANGUAGE);
    expect(DEFAULT_LANGUAGE).toBe('vi');
  });

  it.each([
    ['en-US', 'en'],
    ['vi-VN,vi;q=0.9,en;q=0.8', 'vi'],
    ['en;q=0.8, vi;q=0.9', 'vi'],
    ['fr-FR,en;q=0.7', 'en'],
    ['EN-us', 'en'],
    ['  vi  ', 'vi'],
    ['fr, de;q=0.5', 'vi'],
    ['en;q=abc, vi;q=0.1', 'vi'],
    ['', 'vi'],
  ])('resolves %j to %s', (header, expected) => {
    const { context, request } = contextWith({ 'accept-language': header });

    guard.canActivate(context);

    expect(request.language).toBe(expected);
  });

  it('always allows the request through, even for unsupported languages', () => {
    const { context } = contextWith({ 'accept-language': 'ja-JP' });

    expect(guard.canActivate(context)).toBe(true);
  });
});
