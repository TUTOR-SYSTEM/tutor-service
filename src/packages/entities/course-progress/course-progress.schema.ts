import { z } from 'zod';

const idSchema = z.string().regex(/^[\w.-]{1,64}$/, { message: 'Mã module không hợp lệ' });
const numericKey = z.string().regex(/^\d{1,4}$/, { message: 'Chỉ số câu hỏi không hợp lệ' });
const smallInt = (max: number) => z.number().int().min(0).max(max);
const MAX_MODULES = 200;
const MAX_ITEMS = 200;

/** Snapshot tiến độ gửi từ client. Giới hạn khớp gateway (course-progress.schema.ts). */
export const courseProgressSnapshotSchema = z.object({
  labs: z
    .record(idSchema, z.array(z.boolean()).max(MAX_ITEMS))
    .refine((o) => Object.keys(o).length <= MAX_MODULES, { message: 'Quá nhiều module' }),
  quiz: z.record(idSchema, z.record(numericKey, smallInt(50))),
  debugs: z.record(idSchema, z.boolean()),
  hist: z
    .array(
      z.object({
        l: idSchema,
        s: smallInt(50),
        n: z.number().int().min(1).max(50),
        t: z.number().int().min(0).max(8.64e15),
      }),
    )
    .max(500),
  wrong: z.record(idSchema, z.record(numericKey, smallInt(1_000_000))),
  flag: z.record(idSchema, z.record(numericKey, z.boolean())),
  debugModule: z.record(idSchema, idSchema),
});

/** Payload của pattern `courseProgress.sync`: identity đã seal được xoá trước khi tới đây. */
export const courseProgressSyncSchema = z.object({
  userId: z.string().min(1),
  data: courseProgressSnapshotSchema,
});
