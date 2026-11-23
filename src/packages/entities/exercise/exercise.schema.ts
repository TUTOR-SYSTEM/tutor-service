import z from 'zod';

const fileUrlSchema = z.object({
  name: z.string(),
  url: z.string(),
  key: z.string(),
});

export const exerciseStatusEnum = z.enum(['ASSIGNED', 'SUBMITTED', 'GRADED', 'RESUBMIT']);

export const createExerciseSchema = z.object({
  tutorId: z
    .string({
      message: 'tutorId must be string ...',
    })
    .uuid({
      message: 'tutorId must be uuid ...',
    }),
  sessionId: z.string().uuid({ message: 'Session id must be uuid' }).optional().nullable(),
  lessonId: z.string().uuid({ message: 'Lesson id must be uuid' }).optional().nullable(),
  studentId: z
    .string({
      message: 'studentId id must be string ...',
    })
    .uuid({
      message: 'studentId Id must be uuid ...',
    }),
  issueUrls: z.array(fileUrlSchema).optional().nullable(),
  exerciseUrls: z.array(fileUrlSchema).optional().nullable(),
  status: exerciseStatusEnum.optional(),
});

/**
 * Student re-submission: only the submitted files (and an implicit reset to
 * SUBMITTED) may change. Grading fields are tutor-only via the grade endpoint.
 */
export const submitExerciseSchema = z.object({
  exerciseUrls: z.array(fileUrlSchema).min(1, 'Cần ít nhất một tệp bài làm'),
});

/** Tutor grading payload. Score is on a 0–10 scale. */
export const gradeExerciseSchema = z.object({
  score: z.coerce
    .number({ message: 'score must be a number' })
    .min(0, 'Điểm tối thiểu là 0')
    .max(10, 'Điểm tối đa là 10'),
  comment: z.string().max(2000).optional().nullable(),
  // Đáp án gia sư tải lên khi chấm (không gửi = giữ nguyên đáp án đã lưu).
  answerKeyUrls: z.array(fileUrlSchema).max(5).optional(),
});

/** Tutor asks the student to submit again; optional comment is shown to the student. */
export const requestResubmitExerciseSchema = z.object({
  comment: z.string().max(2000).optional().nullable(),
});

export const getExerciseQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  sessionId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  tutorId: z.string().uuid().optional(),
});
