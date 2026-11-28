import { z } from 'zod';
import { checkUuidValid } from '@packages/helpers/generate.helper';
import {
  addStudentsSchema,
  createClassSchema,
  getClassesQuerySchema,
  updateClassSchema,
} from '@packages/entities/class/class.schema';
import {
  createCurriculumSchema,
  createChapterSchema,
  createLessonBodySchema,
  getChaptersQuerySchema,
  getCurriculumsQuerySchema,
  getLessonsQuerySchema,
  updateChapterSchema,
  updateCurriculumSchema,
  updateLessonSchema,
} from '@packages/entities/curriculum/curriculum.schema';
import {
  createScheduleSchema,
  createSchedulesSchema,
  getSchedulesSchema,
  updateScheduleSchema,
} from '@packages/entities/schedule/schedule.schema';
import {
  createTuitionSchema,
  getTuitionsQuerySchema,
  updateTuitionSchema,
} from '@packages/entities/tuition/tuition.schema';
import { upsertAttendanceSchema } from '@packages/entities/attendance/attendance.schema';

/**
 * Schemas for the payloads the gateway sends over RMQ (`tutor_queue`). Every RPC handler parses
 * its payload with one of these before it reaches a service, so a malformed or unexpected field
 * fails here (422 relayed by RpcExceptionFilter) instead of reaching the business logic. The
 * `data`/`query` parts reuse the same schemas the HTTP routes validate with.
 *
 * `userId`/`role` are the identity the gateway forwards from the verified JWT (CONTRACT C4).
 * Their shape is checked here; whether a service needs them is still decided by that service.
 */
const uuid = z.string().refine((value) => checkUuidValid({ data: value }), {
  message: 'Invalid UUID',
});

const actor = {
  userId: uuid,
  role: z.string().nullish(),
};

// class
export const classCreatePayloadSchema = z.object({ ...actor, data: createClassSchema });
export const classUpdatePayloadSchema = z.object({
  ...actor,
  id: uuid,
  data: updateClassSchema,
});
export const classGetAllPayloadSchema = z.object({
  ...actor,
  query: getClassesQuerySchema.prefault({}),
});
export const classIdPayloadSchema = z.object({ ...actor, id: uuid });
export const classAddStudentsPayloadSchema = z.object({
  ...actor,
  classId: uuid,
  data: addStudentsSchema,
});
export const classRemoveStudentPayloadSchema = z.object({
  ...actor,
  classId: uuid,
  studentId: uuid,
});

// curriculum / chapter / lesson
export const curriculumGenerateCodePayloadSchema = z
  .object({ subject: z.string().max(255).optional() })
  .optional();
export const curriculumCreatePayloadSchema = z.object({
  ...actor,
  createCurriculum: createCurriculumSchema,
});
export const curriculumGetAllPayloadSchema = z.object({
  ...actor,
  query: getCurriculumsQuerySchema.prefault({}),
});
export const curriculumIdPayloadSchema = z.object({ ...actor, id: uuid });
export const curriculumUpdatePayloadSchema = z.object({
  ...actor,
  id: uuid,
  data: updateCurriculumSchema,
});
export const chapterCreatePayloadSchema = z.object({
  ...actor,
  curriculumId: uuid,
  data: createChapterSchema,
});
export const chapterGetAllPayloadSchema = z.object({ query: getChaptersQuerySchema });
export const chapterIdPayloadSchema = z.object({ id: uuid });
export const chapterDeletePayloadSchema = z.object({ ...actor, id: uuid });
export const chapterUpdatePayloadSchema = z.object({
  ...actor,
  id: uuid,
  data: updateChapterSchema,
});
export const lessonCreatePayloadSchema = z.object({
  ...actor,
  curriculumId: uuid,
  chapterId: uuid.nullish(),
  data: createLessonBodySchema,
});
export const lessonGetAllPayloadSchema = z.object({ query: getLessonsQuerySchema });
export const lessonIdPayloadSchema = z.object({ id: uuid });
export const lessonDeletePayloadSchema = z.object({ ...actor, id: uuid });
export const lessonUpdatePayloadSchema = z.object({
  ...actor,
  id: uuid,
  data: updateLessonSchema,
});

// tuition
export const tuitionCreatePayloadSchema = z.object({ ...actor, data: createTuitionSchema });
export const tuitionGetAllPayloadSchema = z.object({
  ...actor,
  query: getTuitionsQuerySchema.prefault({}),
});
export const tuitionGetSummaryPayloadSchema = z.object({
  ...actor,
  classId: uuid.optional(),
});
export const tuitionIdPayloadSchema = z.object({ ...actor, id: uuid });
export const tuitionUpdatePayloadSchema = z.object({
  ...actor,
  id: uuid,
  data: updateTuitionSchema,
});

// schedule
export const scheduleCreatePayloadSchema = z.object({ ...actor, data: createScheduleSchema });
export const scheduleCreateBulkPayloadSchema = z.object({
  ...actor,
  data: createSchedulesSchema,
});
export const scheduleGetAllPayloadSchema = z.object({
  ...actor,
  query: getSchedulesSchema.prefault({}),
});
export const scheduleGetByClassPayloadSchema = z.object({ ...actor, classId: uuid });
export const scheduleIdPayloadSchema = z.object({ ...actor, id: uuid });
export const scheduleUpdatePayloadSchema = z.object({
  ...actor,
  id: uuid,
  data: updateScheduleSchema,
});

// attendance
export const attendanceGetBySessionPayloadSchema = z.object({
  ...actor,
  sessionId: uuid,
});
export const attendanceUpsertPayloadSchema = z.object({
  ...actor,
  data: upsertAttendanceSchema,
});
