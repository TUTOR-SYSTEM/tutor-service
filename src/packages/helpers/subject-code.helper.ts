/**
 * English display name per subject (key = Vietnamese name used by the FE `SUBJECT_OPTIONS`).
 * The curriculum code prefix is derived from the English name, e.g. Mathematics → `MAT`.
 */
export const SUBJECT_EN_NAMES: Readonly<Record<string, string>> = {
  Toán: 'Mathematics',
  'Vật lý': 'Physics',
  'Hóa học': 'Chemistry',
  'Sinh học': 'Biology',
  'Ngữ văn': 'Literature',
  'Tiếng Anh': 'English',
  'Lịch sử': 'History',
  'Địa lý': 'Geography',
  GDCD: 'Civic Education',
  'Tin học': 'Informatics',
  'Công nghệ': 'Technology',
};

const DEFAULT_PREFIX = 'SUB';

/**
 * 3-letter uppercase prefix from the subject's English name (first 3 letters).
 * Unknown subjects fall back to the first 3 ASCII letters of the given name.
 */
export function buildSubjectCodePrefix(subject?: string | null): string {
  const name = subject?.trim() ?? '';
  const english = SUBJECT_EN_NAMES[name] ?? name;
  const letters = english
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .slice(0, 3)
    .toUpperCase();
  return letters || DEFAULT_PREFIX;
}

/** Random 3-digit suffix, `000`–`999`. */
export function generateSubjectCodeSuffix(): string {
  return String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}

/** Candidate subject code `PREFIX-NNN`, e.g. `MAT-463`. Uniqueness is checked by the caller. */
export function generateSubjectCode(subject?: string | null): string {
  return `${buildSubjectCodePrefix(subject)}-${generateSubjectCodeSuffix()}`;
}
