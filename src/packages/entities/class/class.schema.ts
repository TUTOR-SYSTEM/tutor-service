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
  description: z.string().nullable().optional(),
  status: classStatusEnum.default('OPEN').optional(),
  format: sessionFormatEnum.default('OFFLINE').optional(),
  startTime: z.coerce.date({ message: 'Start time must be a valid date' }),
  endTime: z.coerce.date({ message: 'End time must be a valid date' }),
  location: z.string().nullable().optional(),
  curriculumId: z.string().uuid('Invalid curriculum ID').optional().nullable(),
  tutorId: z.string({ message: 'Tutor ID is required' }).uuid('Invalid tutor ID'),
  /** 1 = lớp 1 kèm 1, 10 = lớp nhóm. Bỏ trống = 10. */
  maxStudents: z.coerce.number().int().min(1).max(10).optional(),
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
// `tutorId` stays optional: only ADMIN may reassign a class (enforced in the service).
// `null` clears a nullable field (description / location / curriculumId); `undefined` = unchanged.
export const updateClassSchema = createClassSchema
  .partial()
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
  // ADMIN lọc lớp theo gia sư quản lý.
  tutorId: z.string().uuid('Invalid tutor ID').optional(),
});
