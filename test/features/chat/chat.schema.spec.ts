import {
  addParticipantSchema,
  createDirectConversationSchema,
  createGroupConversationSchema,
  getMessagesQuerySchema,
  messageContentSchema,
  MESSAGE_CONTENT_MAX_LENGTH,
} from 'src/features/chat/chat.schema';

const uuid = (n: number) => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;

describe('chat HTTP schemas (TS-21)', () => {
  describe('getMessagesQuerySchema', () => {
    it('defaults limit to 50 when omitted', () => {
      expect(getMessagesQuerySchema.parse({}).limit).toBe(50);
    });

    it('coerces a numeric query string', () => {
      expect(getMessagesQuerySchema.parse({ limit: '25' }).limit).toBe(25);
    });

    it('caps limit at 100', () => {
      expect(getMessagesQuerySchema.parse({ limit: '100' }).limit).toBe(100);
      expect(getMessagesQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
      expect(getMessagesQuerySchema.safeParse({ limit: '1000000' }).success).toBe(false);
    });

    it('rejects limit 0, negatives, fractions and non-numbers', () => {
      for (const limit of ['0', '-5', '1.5', 'abc', '']) {
        expect(getMessagesQuerySchema.safeParse({ limit }).success).toBe(false);
      }
    });

    it('accepts a uuid cursor and rejects anything else', () => {
      expect(getMessagesQuerySchema.parse({ before: uuid(1) }).before).toBe(uuid(1));
      expect(getMessagesQuerySchema.safeParse({ before: 'not-a-uuid' }).success).toBe(false);
    });
  });

  describe('createDirectConversationSchema', () => {
    it('requires a uuid targetUserId', () => {
      expect(createDirectConversationSchema.safeParse({ targetUserId: uuid(2) }).success).toBe(
        true,
      );
      expect(createDirectConversationSchema.safeParse({ targetUserId: 'x' }).success).toBe(false);
      expect(createDirectConversationSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('createGroupConversationSchema', () => {
    it('caps participantIds at 50', () => {
      const ids = (n: number) => Array.from({ length: n }, (_, i) => uuid(i + 1));
      expect(
        createGroupConversationSchema.safeParse({ name: 'G', participantIds: ids(50) }).success,
      ).toBe(true);
      expect(
        createGroupConversationSchema.safeParse({ name: 'G', participantIds: ids(51) }).success,
      ).toBe(false);
    });

    it('rejects non-uuid participant ids', () => {
      expect(
        createGroupConversationSchema.safeParse({ name: 'G', participantIds: ['abc'] }).success,
      ).toBe(false);
    });

    it('requires a non-empty name of at most 255 characters', () => {
      expect(
        createGroupConversationSchema.safeParse({ name: '   ', participantIds: [] }).success,
      ).toBe(false);
      expect(
        createGroupConversationSchema.safeParse({ name: 'x'.repeat(256), participantIds: [] })
          .success,
      ).toBe(false);
      expect(
        createGroupConversationSchema.safeParse({ name: 'x'.repeat(255), participantIds: [] })
          .success,
      ).toBe(true);
    });
  });

  describe('addParticipantSchema', () => {
    it('requires a uuid userId', () => {
      expect(addParticipantSchema.safeParse({ userId: uuid(3) }).success).toBe(true);
      expect(addParticipantSchema.safeParse({ userId: '' }).success).toBe(false);
    });
  });

  describe('messageContentSchema (TS-22)', () => {
    it(`accepts content up to ${MESSAGE_CONTENT_MAX_LENGTH} characters`, () => {
      expect(messageContentSchema.safeParse('a'.repeat(MESSAGE_CONTENT_MAX_LENGTH)).success).toBe(
        true,
      );
    });

    it('rejects content one character over the limit and empty content', () => {
      expect(
        messageContentSchema.safeParse('a'.repeat(MESSAGE_CONTENT_MAX_LENGTH + 1)).success,
      ).toBe(false);
      expect(messageContentSchema.safeParse('').success).toBe(false);
      expect(messageContentSchema.safeParse(undefined).success).toBe(false);
    });
  });
});
