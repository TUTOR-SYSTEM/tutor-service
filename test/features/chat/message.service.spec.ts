import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MessageService } from 'src/features/chat/message.service';
import { createPrismaMock, PrismaMock } from '../../support/prisma.mock';

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333';
const NOT_A_MEMBER = 'You are not a participant of this conversation';

const notFound = () =>
  new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: 'test' });

describe('MessageService', () => {
  let service: MessageService;
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new MessageService(prisma as never);
  });

  const asParticipant = () =>
    prisma.conversationParticipant.findUnique.mockResolvedValue({ id: 'p1' });

  describe('getMessages', () => {
    it('returns the latest messages oldest-first for a participant', async () => {
      const newest = { id: 'm2', createdAt: new Date('2026-10-02') };
      const oldest = { id: 'm1', createdAt: new Date('2026-10-01') };
      asParticipant();
      prisma.message.findMany.mockResolvedValue([newest, oldest]); // page, newest first

      const result = await service.getMessages(CONVERSATION_ID, USER_ID, 50);

      expect(result).toEqual([oldest, newest]);
      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { conversationId: CONVERSATION_ID },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      );
      expect(prisma.conversationParticipant.findUnique).toHaveBeenCalledWith({
        where: { conversationId_userId: { conversationId: CONVERSATION_ID, userId: USER_ID } },
        select: { id: true },
      });
    });

    it('rejects a non-participant before reading any messages', async () => {
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);

      await expect(service.getMessages(CONVERSATION_ID, USER_ID)).rejects.toThrow(
        new ForbiddenException(NOT_A_MEMBER),
      );
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    it('adds a createdAt cursor when `before` points to an existing message', async () => {
      const cursor = new Date('2026-10-05');
      asParticipant();
      prisma.message.findUnique.mockResolvedValue({ createdAt: cursor });
      prisma.message.findMany.mockResolvedValue([]);

      await service.getMessages(CONVERSATION_ID, USER_ID, 20, MESSAGE_ID);

      expect(prisma.message.findUnique).toHaveBeenCalledWith({
        where: { id: MESSAGE_ID },
        select: { createdAt: true },
      });
      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { conversationId: CONVERSATION_ID, createdAt: { lt: cursor } },
          take: 20,
        }),
      );
    });

    it('ignores an unknown `before` cursor and still returns the page', async () => {
      asParticipant();
      prisma.message.findUnique.mockResolvedValue(null); // cursor not found
      prisma.message.findMany.mockResolvedValue([{ id: 'm1' }]);

      await expect(service.getMessages(CONVERSATION_ID, USER_ID, 20, MESSAGE_ID)).resolves.toEqual([
        { id: 'm1' },
      ]);
      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { conversationId: CONVERSATION_ID } }),
      );
    });
  });

  describe('createMessage', () => {
    it('inserts with status SENT and bumps the conversation lastMessageAt', async () => {
      const inserted = { id: MESSAGE_ID, content: 'hi' };
      asParticipant();
      prisma.message.create.mockResolvedValue(inserted);

      await expect(service.createMessage(CONVERSATION_ID, USER_ID, 'hi')).resolves.toEqual(
        inserted,
      );

      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          conversationId: CONVERSATION_ID,
          senderId: USER_ID,
          content: 'hi',
          status: 'SENT',
        },
      });
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: CONVERSATION_ID },
        data: { lastMessageAt: expect.any(Date) },
      });
    });

    it('rejects a non-participant and writes nothing', async () => {
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);

      await expect(service.createMessage(CONVERSATION_ID, USER_ID, 'hi')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.message.create).not.toHaveBeenCalled();
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });
  });

  describe('updateMessageStatus', () => {
    it('returns the updated row for DELIVERED and READ', async () => {
      prisma.message.update.mockResolvedValue({ id: MESSAGE_ID, status: 'READ' });

      await expect(service.updateMessageStatus(MESSAGE_ID, 'READ')).resolves.toEqual({
        id: MESSAGE_ID,
        status: 'READ',
      });
      expect(prisma.message.update).toHaveBeenCalledWith({
        where: { id: MESSAGE_ID },
        data: { status: 'READ' },
      });
    });

    it('returns undefined when the message does not exist', async () => {
      prisma.message.update.mockRejectedValue(notFound());

      await expect(service.updateMessageStatus(MESSAGE_ID, 'DELIVERED')).resolves.toBeUndefined();
    });

    it('rethrows unexpected errors', async () => {
      prisma.message.update.mockRejectedValue(new Error('boom'));

      await expect(service.updateMessageStatus(MESSAGE_ID, 'READ')).rejects.toThrow('boom');
    });
  });

  describe('markConversationAsRead', () => {
    it("updates the reader lastReadAt and marks others' messages READ", async () => {
      await service.markConversationAsRead(CONVERSATION_ID, USER_ID);

      expect(prisma.conversationParticipant.updateMany).toHaveBeenCalledWith({
        where: { conversationId: CONVERSATION_ID, userId: USER_ID },
        data: { lastReadAt: expect.any(Date) },
      });
      expect(prisma.message.updateMany).toHaveBeenCalledWith({
        where: {
          conversationId: CONVERSATION_ID,
          senderId: { not: USER_ID },
          status: { not: 'READ' },
        },
        data: { status: 'READ' },
      });
    });
  });

  describe('getUnreadCounts', () => {
    it('maps the grouped rows to a conversationId -> count record, coercing to numbers', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { conversationId: 'c1', count: '3' },
        { conversationId: 'c2', count: 0 },
      ]);

      await expect(service.getUnreadCounts(USER_ID)).resolves.toEqual({ c1: 3, c2: 0 });
    });

    it('returns an empty record when the user has no conversations', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(service.getUnreadCounts(USER_ID)).resolves.toEqual({});
    });

    it('binds the user id as a query parameter', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.getUnreadCounts(USER_ID);

      const [, ...params] = prisma.$queryRaw.mock.calls[0];
      expect(params).toEqual([USER_ID, USER_ID]);
    });
  });
});
