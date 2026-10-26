import { z } from 'zod';
import { chatSchema, getHistoryQuerySchema } from './ai-chat.schema';

export type ChatDto = z.infer<typeof chatSchema>;
export type GetHistoryQueryDto = z.infer<typeof getHistoryQuerySchema>;
