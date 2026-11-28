import { courseProgressSyncSchema } from '@packages/entities/course-progress';

const valid = {
  userId: 'u1',
  data: {
    labs: { 'lb1-2': [true, false] },
    quiz: { 'lb1-2': { '0': 1 } },
    debugs: { d1: true },
    hist: [{ l: 'lb1-2', s: 8, n: 10, t: 1_800_000_000_000 }],
    wrong: { 'lb1-2': { '0': 2 } },
    flag: { 'lb1-2': { '0': true } },
    debugModule: { d1: 'lb1-2' },
  },
};

describe('courseProgressSyncSchema (TS-08)', () => {
  it('accepts a normal snapshot', () => {
    expect(courseProgressSyncSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects more than 500 history rows', () => {
    const hist = Array.from({ length: 501 }, () => ({ l: 'a', s: 1, n: 1, t: 1 }));
    const r = courseProgressSyncSchema.safeParse({ ...valid, data: { ...valid.data, hist } });
    expect(r.success).toBe(false);
  });

  it('rejects a question key that is not a small integer (NaN guard)', () => {
    const quiz = { 'lb1-2': { abc: 1 } };
    const r = courseProgressSyncSchema.safeParse({ ...valid, data: { ...valid.data, quiz } });
    expect(r.success).toBe(false);
  });

  it('rejects more than 200 modules in labs', () => {
    const labs = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`m${i}`, [true]]));
    const r = courseProgressSyncSchema.safeParse({ ...valid, data: { ...valid.data, labs } });
    expect(r.success).toBe(false);
  });

  it('rejects a missing userId', () => {
    expect(courseProgressSyncSchema.safeParse({ data: valid.data }).success).toBe(false);
  });
});
