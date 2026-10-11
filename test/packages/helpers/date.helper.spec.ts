import { toDate } from '@packages/helpers/date.helper';

describe('toDate', () => {
  it('converts an ISO string into a Date', () => {
    const result = toDate('2026-10-05T08:30:00.000Z');

    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe('2026-10-05T08:30:00.000Z');
  });

  it('keeps an existing Date instance as the same object', () => {
    const date = new Date('2026-01-01T00:00:00Z');

    expect(toDate(date)).toBe(date);
  });

  it('passes null and undefined through unchanged', () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeUndefined();
  });

  it('returns an Invalid Date for a malformed string rather than throwing', () => {
    const result = toDate('not-a-date');

    expect(result).toBeInstanceOf(Date);
    expect(Number.isNaN(result?.getTime())).toBe(true);
  });
});
