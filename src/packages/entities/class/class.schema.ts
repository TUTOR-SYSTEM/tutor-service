import { z } from 'zod';

export const classStatusEnum = z.enum(['OPEN', 'CLOSED', 'UPCOMING']);
export const sessionFormatEnum = z.enum(['ONLINE', 'OFFLINE']);

export const createClassSchema = z.object({
  name: z
    .string({ message: 'Name is required' })
    .min(1, 'Name is required')
    .max(255, 'Name too long'),
  code: z.string().min(1).max(50),
  subject: z
    .string({ message: 'Subject is required' })
    .min(1, 'Subject is required')
    .max(255, 'Subject too long'),
  tuition: z.coerce.number().min(0).default(0).optional(),
  description: z.string().optional(),
  status: classStatusEnum.default('OPEN').optional(),
  format: sessionFormatEnum.default('OFFLINE').optional(),
  startTime: z.coerce.date({ message: 'Start time must be a valid date' }),
  endTime: z.coerce.date({ message: 'End time must be a valid date' }),
  location: z.string().optional(),
  curriculumId: z.string().uuid('Invalid curriculum ID').optional().nullable(),
  tutorId: z.string({ message: 'Tutor ID is required' }).uuid('Invalid tutor ID'),
  schedulesId: z
    .array(
      z
        .string({ message: 'Schedules Id must be string' })
        .uuid({ message: 'Schedules Id must be uuid ...' })
        .optional(),
    )
    .default([]),
});

// `.partial()` keeps the `.default(...)` of wrapped fields, so an update that omits `tuition`,
// `status`, `format` or `schedulesId` would overwrite them with the defaults. Redeclare them
// without a default so "absent" really means "unchanged".
export const updateClassSchema = createClassSchema
  .partial()
  .omit({ tutorId: true })
  .extend({
    tuition: z.coerce.number().min(0).optional(),
    status: classStatusEnum.optional(),
    format: sessionFormatEnum.optional(),
    schedulesId: z.array(z.string().uuid({ message: 'Schedules Id must be uuid ...' })).optional(),
    studentIds: z.array(z.string().uuid('Invalid student ID')).max(100).optional(),
  });

export const addStudentsSchema = z.object({
  studentIds: z
    .array(z.string().uuid('Invalid student ID'))
    .min(1, 'At least 1 student is required')
    .max(100, 'At most 100 students at once'),
});

export const getClassesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().min(1).optional(),
  status: classStatusEnum.optional(),
  subject: z.string().optional(),
  studentsId: z.string().uuid('Invalid student ID').optional(),
});
