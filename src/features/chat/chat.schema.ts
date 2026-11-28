import { z } from 'zod';

// Hard limits for chat input. Keep in sync with the gateway/UI copy of these numbers.
export const MESSAGE_CONTENT_MAX_LENGTH = 4000;
export const MESSAGE_RATE_LIMIT_MAX = 20; // message:send per socket ...
export const MESSAGE_RATE_WINDOW_MS = 10_000; // ... within this fixed window
export const MESSAGE_LIST_MAX_LIMIT = 100;
export const MESSAGE_LIST_DEFAULT_LIMIT = 50;
export const GROUP_MAX_PARTICIPANTS = 50;
export const CONVERSATION_NAME_MAX_LENGTH = 255;

export const messageContentSchema = z.string().min(1).max(MESSAGE_CONTENT_MAX_LENGTH);

export const getMessagesQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MESSAGE_LIST_MAX_LIMIT)
    .default(MESSAGE_LIST_DEFAULT_LIMIT),
  before: z.uuid().optional(),
});

export const createDirectConversationSchema = z.object({
  targetUserId: z.uuid(),
});

export const createGroupConversationSchema = z.object({
  name: z.string().trim().min(1).max(CONVERSATION_NAME_MAX_LENGTH),
  participantIds: z.array(z.uuid()).max(GROUP_MAX_PARTICIPANTS),
});

export const addParticipantSchema = z.object({
  userId: z.uuid(),
});

export type GetMessagesQueryDto = z.infer<typeof getMessagesQuerySchema>;
export type CreateDirectConversationDto = z.infer<typeof createDirectConversationSchema>;
export type CreateGroupConversationDto = z.infer<typeof createGroupConversationSchema>;
export type AddParticipantDto = z.infer<typeof addParticipantSchema>;
