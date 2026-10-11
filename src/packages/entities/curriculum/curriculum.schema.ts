import { z } from 'zod';

export const curriculumStatusEnum = z.enum(['COMPLETED', 'UPCOMING']);

export const createCurriculumSchema = z.object({
  subject: z
    .string({ message: 'Title is required' })
    .min(1, 'Title is required')
    .max(255, 'Title too long'),
  code: z
    .string({ message: 'Code curriculum must be string ...' })
    .min(1, {
      message: 'Code curriculum must me 6 character ...',
    })
    .max(6, {
      message: 'Code curriculum must me 6 character ...',
    }),
  grade: z.union([z.string(), z.number()]).transform((value) => Number(value)),
  courseTime: z.string({ message: 'Course time must be string ...' }),
  description: z.string().optional(),
  gradesId: z.string().uuid('Invalid grade ID'),
});

export const updateCurriculumSchema = createCurriculumSchema.partial();

export const getCurriculumsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().min(1).optional(),
});

export const lessonFileSchema = z.object({
  name: z.string().min(1, 'File name is required'),
  url: z.string().url('Invalid URL'),
  key: z.string().min(1, 'File key is required'),
});

export const createChapterSchema = z.object({
  title: z
    .string({ message: 'Title is required' })
    .min(1, 'Title is required')
    .max(255, 'Title too long'),
  description: z.string().optional(),
  order: z.coerce.number().int().default(0).optional(),
});

// `order` is redeclared without a default: `.partial()` keeps `.default(0)` and would reset the
// ordering on every update that doesn't send it.
export const updateChapterSchema = createChapterSchema
  .partial()
  .extend({ order: z.coerce.number().int().optional() });

export const createLessonSchema = z.object({
  title: z
    .string({ message: 'Title is required' })
    .min(1, 'Title is required')
    .max(255, 'Title too long'),
  description: z.string().optional(),
  curriculumId: z.string().uuid('Invalid curriculum ID'),
  chapterId: z.string().uuid('Invalid chapter ID').optional().nullable(),
  theoryUrls: z.array(lessonFileSchema).optional(),
  exerciseUrls: z.array(lessonFileSchema).optional(),
  order: z.coerce.number().int().default(0).optional(),
});

export const updateLessonSchema = createLessonSchema
  .partial()
  .extend({ order: z.coerce.number().int().optional() });

export const createLessonBodySchema = createLessonSchema.omit({
  curriculumId: true,
  chapterId: true,
});

export const getChaptersQuerySchema = z.object({
  curriculumId: z.string().uuid('Invalid curriculum ID'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const getLessonsQuerySchema = z.object({
  curriculumId: z.string().uuid('Invalid curriculum ID'),
  chapterId: z.string().uuid('Invalid chapter ID').optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const assignmentStatusEnum = z.enum(['COMPLETED', 'OVERDUE', 'IN_PROGRESS']);

export const createAssignmentSchema = z.object({
  classId: z.string().uuid('Invalid class ID'),
  curriculumId: z.string().uuid().optional().nullable(),
  lesson: z.coerce.number().int().min(1, 'Lesson number is required'),
  name: z
    .string({ message: 'Name is required' })
    .min(1, 'Name is required')
    .max(255, 'Name too long'),
  description: z.string().optional(),
  requirement: z.string().optional(),
  status: assignmentStatusEnum.default('IN_PROGRESS').optional(),
  score: z.coerce.number().min(0).max(10).optional().nullable(),
  comment: z.string().optional(),
  isHidden: z.boolean().default(false).optional(),
});

export const updateAssignmentSchema = createAssignmentSchema
  .partial()
  .omit({ classId: true, lesson: true });

export const getAssignmentsQuerySchema = z.object({
  classId: z.string().uuid('Invalid class ID'),
  lesson: z.coerce.number().int().optional(),
  status: assignmentStatusEnum.optional(),
});

export const removeLessonFileSchema = z
  .object({
    url: z.string().url('Invalid URL').optional(),
    key: z.string().min(1, 'File key is required').optional(),
  })
  .refine((data) => data.url || data.key, {
    message: 'Either url or key is required',
  });
