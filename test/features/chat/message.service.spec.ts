import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DRIZZLE } from 'src/database/database.module';
import { MessageService } from 'src/features/chat/message.service';

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333';
const NOT_A_MEMBER = 'You are not a participant of this conversation';

// Drizzle builders are chainable and awaitable: every chain method returns the chain, and
// awaiting the chain resolves to the scripted result for that query.
const chain = (result: unknown) => {
  const c: Record<string, unknown> = {};
  for (const m of [
    'from',
    'where',
    'limit',
    'orderBy',
    'leftJoin',
    'groupBy',
    'values',
    'set',
    'returning',
  ]) {
    c[m] = jest.fn(() => c);
  }
  c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return c;
};

describe('MessageService', () => {
  let service: MessageService;
  let db: { select: jest.Mock; insert: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    db = { select: jest.fn(), insert: jest.fn(), update: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [MessageService, { provide: DRIZZLE, useValue: db }],
    }).compile();

    service = module.get(MessageService);
  });

  describe('getMessages', () => {
    it('returns the latest messages oldest-first for a participant', async () => {
      const newest = { id: 'm2', createdAt: new Date('2026-10-02') };
      const oldest = { id: 'm1', createdAt: new Date('2026-10-01') };
      db.select
        .mockReturnValueOnce(chain([{ userId: USER_ID }])) // participant check
        .mockReturnValueOnce(chain([newest, oldest])); // page, newest first

      const result = await service.getMessages(CONVERSATION_ID, USER_ID, 50);

      expect(result).toEqual([oldest, newest]);
    });

    it('rejects a non-participant before reading any messages', async () => {
      db.select.mockReturnValueOnce(chain([]));

      await expect(service.getMessages(CONVERSATION_ID, USER_ID)).rejects.toThrow(
        new ForbiddenException(NOT_A_MEMBER),
      );
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('adds a createdAt cursor when `before` points to an existing message', async () => {
      db.select
        .mockReturnValueOnce(chain([{ userId: USER_ID }]))
        .mockReturnValueOnce(chain([{ createdAt: new Date('2026-10-05') }])) // cursor lookup
        .mockReturnValueOnce(chain([]));

      await service.getMessages(CONVERSATION_ID, USER_ID, 20, MESSAGE_ID);

      // participant check + cursor lookup + page query = 3 selects
      expect(db.select).toHaveBeenCalledTimes(3);
    });

    it('ignores an unknown `before` cursor and still returns the page', async () => {
      db.select
        .mockReturnValueOnce(chain([{ userId: USER_ID }]))
        .mockReturnValueOnce(chain([])) // cursor not found
        .mockReturnValueOnce(chain([{ id: 'm1' }]));

      await expect(service.getMessages(CONVERSATION_ID, USER_ID, 20, MESSAGE_ID)).resolves.toEqual([
        { id: 'm1' },
      ]);
    });
  });

  describe('createMessage', () => {
    it('inserts with status SENT and bumps the conversation lastMessageAt', async () => {
      const inserted = { id: MESSAGE_ID, content: 'hi' };
      db.select.mockReturnValueOnce(chain([{ userId: USER_ID }]));
      db.insert.mockReturnValueOnce(chain([inserted]));
      db.update.mockReturnValueOnce(chain(undefined));

      await expect(service.createMessage(CONVERSATION_ID, USER_ID, 'hi')).resolves.toEqual(
        inserted,
      );

      const insertChain = db.insert.mock.results[0].value;
      expect(insertChain.values).toHaveBeenCalledWith({
        conversationId: CONVERSATION_ID,
        senderId: USER_ID,
        content: 'hi',
        status: 'SENT',
      });
      expect(db.update).toHaveBeenCalledTimes(1);
    });

    it('rejects a non-participant and writes nothing', async () => {
      db.select.mockReturnValueOnce(chain([]));

      await expect(service.createMessage(CONVERSATION_ID, USER_ID, 'hi')).rejects.toThrow(
        ForbiddenException,
      );
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('updateMessageStatus', () => {
    it('returns the updated row for DELIVERED and READ', async () => {
      db.update.mockReturnValueOnce(chain([{ id: MESSAGE_ID, status: 'READ' }]));

      await expect(service.updateMessageStatus(MESSAGE_ID, 'READ')).resolves.toEqual({
        id: MESSAGE_ID,
        status: 'READ',
      });
    });

    it('returns undefined when the message does not exist', async () => {
      db.update.mockReturnValueOnce(chain([]));

      await expect(service.updateMessageStatus(MESSAGE_ID, 'DELIVERED')).resolves.toBeUndefined();
    });
  });

  describe('markConversationAsRead', () => {
    it("updates the reader lastReadAt and marks others' messages READ", async () => {
      db.update.mockReturnValueOnce(chain(undefined)).mockReturnValueOnce(chain(undefined));

      await service.markConversationAsRead(CONVERSATION_ID, USER_ID);

      expect(db.update).toHaveBeenCalledTimes(2);
      const participantSet = db.update.mock.results[0].value.set;
      expect(participantSet).toHaveBeenCalledWith({ lastReadAt: expect.any(Date) });
      const messageSet = db.update.mock.results[1].value.set;
      expect(messageSet).toHaveBeenCalledWith({ status: 'READ' });
    });
  });

  describe('getUnreadCounts', () => {
    it('maps the grouped rows to a conversationId -> count record, coercing to numbers', async () => {
      db.select.mockReturnValueOnce(
        chain([
          { conversationId: 'c1', count: '3' },
          { conversationId: 'c2', count: 0 },
        ]),
      );

      await expect(service.getUnreadCounts(USER_ID)).resolves.toEqual({ c1: 3, c2: 0 });
    });

    it('returns an empty record when the user has no conversations', async () => {
      db.select.mockReturnValueOnce(chain([]));

      await expect(service.getUnreadCounts(USER_ID)).resolves.toEqual({});
    });
  });
});
