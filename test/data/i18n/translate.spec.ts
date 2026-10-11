import { translateMessage, toCodeMap, type TranslationDict } from 'src/data/i18n/translate';

const dict: TranslationDict = {
  CLASS_NOT_FOUND: { vi: 'Không tìm thấy lớp', en: 'Class not found' },
  EMAIL_EXISTS: { vi: 'Email đã tồn tại', en: 'Email already exists' },
  VI_ONLY: { vi: 'Chỉ tiếng Việt', en: undefined as unknown as string },
};

describe('translateMessage', () => {
  it('returns the localized string for an exact code match', () => {
    expect(translateMessage(dict, 'CLASS_NOT_FOUND', 'en')).toBe('Class not found');
    expect(translateMessage(dict, 'CLASS_NOT_FOUND', 'vi')).toBe('Không tìm thấy lớp');
  });

  it('localizes the code and keeps the dynamic suffix after ": "', () => {
    expect(translateMessage(dict, 'EMAIL_EXISTS: a@b.dev', 'en')).toBe(
      'Email already exists: a@b.dev',
    );
  });

  it('keeps everything after the first ": " as the suffix', () => {
    expect(translateMessage(dict, 'EMAIL_EXISTS: x: y', 'vi')).toBe('Email đã tồn tại: x: y');
  });

  it('falls back to the default language when the requested one is missing', () => {
    expect(translateMessage(dict, 'VI_ONLY', 'en')).toBe('Chỉ tiếng Việt');
  });

  it('returns unknown messages untouched', () => {
    expect(translateMessage(dict, 'Plain English text', 'en')).toBe('Plain English text');
    expect(translateMessage(dict, 'UNKNOWN_CODE: extra', 'en')).toBe('UNKNOWN_CODE: extra');
  });

  it('returns an empty string for undefined or empty input', () => {
    expect(translateMessage(dict, undefined, 'en')).toBe('');
    expect(translateMessage(dict, '', 'vi')).toBe('');
  });

  it('does not treat a leading ": " (no code) as a composed message', () => {
    expect(translateMessage(dict, ': CLASS_NOT_FOUND', 'en')).toBe(': CLASS_NOT_FOUND');
  });
});

describe('toCodeMap', () => {
  it('maps every key of the dictionary to itself', () => {
    const codes = toCodeMap(dict);

    expect(codes).toEqual({
      CLASS_NOT_FOUND: 'CLASS_NOT_FOUND',
      EMAIL_EXISTS: 'EMAIL_EXISTS',
      VI_ONLY: 'VI_ONLY',
    });
  });
});

describe('translateMessage fallbacks when no language has a string', () => {
  const emptyDict = {
    BLANK: { vi: undefined, en: undefined },
  } as unknown as TranslationDict;

  it('returns the raw exact code when the entry has no string in any language', () => {
    expect(translateMessage(emptyDict, 'BLANK', 'en')).toBe('BLANK');
  });

  it('keeps the code and suffix when the composed entry has no string in any language', () => {
    expect(translateMessage(emptyDict, 'BLANK: detail', 'vi')).toBe('BLANK: detail');
  });
});
