import { z } from 'zod';

export const dayOfWeekEnum = z.enum([
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
]);

export const dayOfWeeks = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;
export const sessionFormatEnum = z.enum(['ONLINE', 'OFFLINE']);

// 00:00–23:59 (the old /^\d{2}:\d{2}$/ accepted "99:99").
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time format (HH:mm)');

export const createScheduleSchema = z.object({
  classId: z.string().uuid('Invalid class ID'),
  dayOfWeek: dayOfWeekEnum,
  startTime: timeOfDay,
  endTime: timeOfDay,
  format: sessionFormatEnum.default('ONLINE'),
  location: z.string().optional(),
});

export const createSchedulesSchema = z.object({
  classId: z.string().uuid('Invalid class ID'),
  schedules: z
    .array(
      z.object({
        dayOfWeek: dayOfWeekEnum,
        startTime: timeOfDay,
        endTime: timeOfDay,
        format: sessionFormatEnum.default('ONLINE'),
        location: z.string().optional(),
      }),
    )
    .min(1, 'At least 1 schedule is required')
    .max(7, 'At most 7 schedules allowed'),
});

export const getSchedulesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().optional(),
  classId: z.string().uuid('Invalid class ID').optional(),
});

// `format` is redeclared without a default, otherwise `.partial()` resets it to ONLINE.
export const updateScheduleSchema = createScheduleSchema
  .partial()
  .omit({ classId: true })
  .extend({ format: sessionFormatEnum.optional() });
