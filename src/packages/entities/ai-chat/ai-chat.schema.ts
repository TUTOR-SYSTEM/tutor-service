import { z } from 'zod';

export const chatSchema = z.object({
  message: z.string().min(1, 'Message is required').max(4000, 'Message too long'),
});

export const getHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
