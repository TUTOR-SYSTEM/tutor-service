import { updateChapterSchema, updateLessonSchema } from '@packages/entities/curriculum';
import { updateClassSchema } from '@packages/entities/class';
import { createScheduleSchema, updateScheduleSchema } from '@packages/entities/schedule';
import { createTuitionSchema, updateTuitionSchema } from '@packages/entities/tuition';

// Zod 4 keeps `.default(...)` when a field is wrapped by `.partial()`, so an update that omitted
// a field silently overwrote it with the default. These guard against that regression.
describe('update schemas do not inject create-time defaults', () => {
  it('class: omitted tuition/status/format/schedulesId stay undefined', () => {
    expect(updateClassSchema.parse({ name: 'New name' })).toEqual({ name: 'New name' });
  });

  it('tuition: omitted status stays undefined (a PAID row is not reset to UNPAID)', () => {
    expect(updateTuitionSchema.parse({ note: 'x' })).toEqual({ note: 'x' });
  });

  it('schedule: omitted format stays undefined', () => {
    expect(updateScheduleSchema.parse({ location: 'Room 1' })).toEqual({ location: 'Room 1' });
  });

  it('chapter and lesson: omitted order stays undefined', () => {
    expect(updateChapterSchema.parse({ title: 'T' })).toEqual({ title: 'T' });
    expect(updateLessonSchema.parse({ title: 'T' })).toEqual({ title: 'T' });
  });

  it('explicit values are still accepted', () => {
    expect(updateTuitionSchema.parse({ status: 'PAID' })).toEqual({ status: 'PAID' });
    expect(updateClassSchema.parse({ tuition: '5', format: 'ONLINE' })).toEqual({
      tuition: 5,
      format: 'ONLINE',
    });
  });

  it('create schemas still apply their defaults', () => {
    const classId = '11111111-1111-4111-8111-111111111111';
    const studentId = '22222222-2222-4222-8222-222222222222';
    expect(createTuitionSchema.parse({ classId, studentId, amount: 1 }).status).toBe('UNPAID');
    expect(
      createScheduleSchema.parse({
        classId,
        dayOfWeek: 'MONDAY',
        startTime: '08:00',
        endTime: '09:00',
      }).format,
    ).toBe('ONLINE');
  });

  it('tuition dates: null stays null instead of becoming 1970-01-01', () => {
    expect(updateTuitionSchema.parse({ paidDate: null })).toEqual({ paidDate: null });
  });

  it('schedule times reject out-of-range values such as 99:99 and 25:00', () => {
    const base = { classId: '11111111-1111-4111-8111-111111111111', dayOfWeek: 'MONDAY' };
    expect(
      createScheduleSchema.safeParse({ ...base, startTime: '99:99', endTime: '09:00' }).success,
    ).toBe(false);
    expect(
      createScheduleSchema.safeParse({ ...base, startTime: '08:00', endTime: '25:00' }).success,
    ).toBe(false);
    expect(
      createScheduleSchema.safeParse({ ...base, startTime: '00:00', endTime: '23:59' }).success,
    ).toBe(true);
  });
});
