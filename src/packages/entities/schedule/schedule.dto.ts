import { z } from 'zod';
import {
  createScheduleSchema,
  createSchedulesSchema,
  getSchedulesSchema,
  updateScheduleSchema,
} from './schedule.schema';

export type CreateScheduleDto = z.infer<typeof createScheduleSchema>;
export type CreateSchedulesDto = z.infer<typeof createSchedulesSchema>;
export type GetSchedulesQueryDto = z.infer<typeof getSchedulesSchema>;
export type UpdateScheduleDto = z.infer<typeof updateScheduleSchema>;
