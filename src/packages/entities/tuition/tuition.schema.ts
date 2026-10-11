import { z } from 'zod';

export const tuitionStatusEnum = z.enum(['PAID', 'UNPAID', 'OVERDUE']);

export const createTuitionSchema = z.object({
  classId: z.string().uuid('Invalid class ID'),
  studentId: z.string().uuid('Invalid student ID'),
  amount: z.coerce.number({ message: 'Amount is required' }).min(0, 'Amount must be positive'),
  // nullable() first: `z.coerce.date()` alone turns null into 1970-01-01.
  dueDate: z.coerce.date().nullable().optional(),
  paidDate: z.coerce.date().nullable().optional(),
  status: tuitionStatusEnum.default('UNPAID').optional(),
  note: z.string().optional(),
});

// Redeclare `status` without a default: `.partial()` keeps `.default('UNPAID')`, which would
// reset a PAID tuition to UNPAID on any update that doesn't send a status.
export const updateTuitionSchema = createTuitionSchema
  .partial()
  .omit({ classId: true, studentId: true })
  .extend({ status: tuitionStatusEnum.optional() });

export const getTuitionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  classId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  status: tuitionStatusEnum.optional(),
});
