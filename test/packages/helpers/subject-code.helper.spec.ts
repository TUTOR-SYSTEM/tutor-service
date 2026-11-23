import {
  buildSubjectCodePrefix,
  generateSubjectCode,
  generateSubjectCodeSuffix,
} from 'src/packages/helpers/subject-code.helper';

describe('subject-code helper', () => {
  it('derives the prefix from the English subject name', () => {
    expect(buildSubjectCodePrefix('Toán')).toBe('MAT');
    expect(buildSubjectCodePrefix('Vật lý')).toBe('PHY');
    expect(buildSubjectCodePrefix('Tiếng Anh')).toBe('ENG');
    expect(buildSubjectCodePrefix('GDCD')).toBe('CIV');
  });

  it('falls back to ASCII letters for unknown subjects and SUB when empty', () => {
    expect(buildSubjectCodePrefix('Nhạc')).toBe('NHA');
    expect(buildSubjectCodePrefix('')).toBe('SUB');
    expect(buildSubjectCodePrefix(undefined)).toBe('SUB');
  });

  it('generates a 3-digit suffix in 000-999', () => {
    for (let i = 0; i < 50; i++) expect(generateSubjectCodeSuffix()).toMatch(/^\d{3}$/);
  });

  it('builds PREFIX-NNN codes', () => {
    expect(generateSubjectCode('Toán')).toMatch(/^MAT-\d{3}$/);
  });
});
