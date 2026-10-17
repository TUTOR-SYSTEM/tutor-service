import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getTableName, type Table } from 'drizzle-orm';
import { DRIZZLE } from 'src/database/database.module';
import {
  classes,
  classStudents,
  conversationParticipants,
  conversations,
  messages,
  users,
} from 'src/database/schema';
import { ConversationService } from 'src/features/chat/conversation.service';
import { ERROR_MESSAGES } from 'src/data/constants';

const CURRENT = 'user-current';
const TARGET = 'user-target';
const CONV_ID = 'conv-1';
const NEW_CONV_ID = 'conv-new';
const NOT_A_MEMBER = 'You are not a participant of this conversation';

type Op = 'select' | 'insert' | 'update';

// Result scripting: every awaited query pops the next result queued for its (operation, table).
// Sub-queries passed into `inArray` / `and` are never awaited, so they do not consume results.
// Results must therefore be queued in the order the service awaits them for each table.
const queues = new Map<string, unknown[]>();

const queue = (op: Op, table: Table, ...results: unknown[]) => {
  const key = `${op}:${getTableName(table)}`;
  queues.set(key, [...(queues.get(key) ?? []), ...results]);
};

const builder = (op: Op, initialTable?: Table) => {
  let key = initialTable ? `${op}:${getTableName(initialTable)}` : '';
  const chain: Record<string, unknown> = {};
  for (const method of [
    'where',
    'limit',
    'orderBy',
    'innerJoin',
    'leftJoin',
    'groupBy',
    'values',
    'set',
    'returning',
  ]) {
    chain[method] = jest.fn(() => chain);
  }
  chain.from = jest.fn((table: Table) => {
    key = `${op}:${getTableName(table)}`;
    return chain;
  });
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(queues.get(key)?.shift() ?? []).then(resolve, reject);
  return chain;
};

// `from` is only chained on select; insert/update pin the table at the call site.
const createDb = () => ({
  select: jest.fn(() => builder('select')),
  selectDistinctOn: jest.fn(() => builder('select')),
  insert: jest.fn((table: Table) => builder('insert', table)),
  update: jest.fn((table: Table) => builder('update', table)),
});

let db: ReturnType<typeof createDb>;

const user = (id: string, role: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  role,
  firstName: 'First',
  lastName: 'Last',
  avatar: null,
  ...extra,
});

// Queues the three queries of getConversationById for a conversation the caller belongs to.
const queueConversationDetail = ({
  participant = [{ userId: CURRENT }],
  conv = [{ id: CONV_ID, type: 'DIRECT' }],
  participants = [],
  lastMessage = [],
}: {
  participant?: unknown[];
  conv?: unknown[];
  participants?: unknown[];
  lastMessage?: unknown[];
} = {}) => {
  queue('select', conversationParticipants, participant, participants);
  queue('select', conversations, conv);
  queue('select', messages, lastMessage);
};

const queueInsertConversation = (id = NEW_CONV_ID) => {
  queue('insert', conversations, [{ id }]);
  queue('insert', conversationParticipants, []);
};

describe('ConversationService', () => {
  let service: ConversationService;

  beforeEach(async () => {
    queues.clear();
    db = createDb();

    const module: TestingModule = await Test.createTestingModule({
      providers: [ConversationService, { provide: DRIZZLE, useValue: db }],
    }).compile();

    service = module.get(ConversationService);
  });

  describe('getConversations', () => {
    it('returns an empty list when the user has no conversations', async () => {
      queue('select', conversations, []);

      await expect(service.getConversations(CURRENT)).resolves.toEqual([]);
      expect(db.selectDistinctOn).not.toHaveBeenCalled();
    });

    it('assembles participants, last message and unread count per conversation', async () => {
      const lastAt = new Date('2026-10-05');
      const convRow = {
        id: 'c1',
        type: 'GROUP',
        name: 'Group',
        classId: null,
        createdBy: CURRENT,
        lastMessageAt: lastAt,
        createdAt: lastAt,
      };
      const joinedAt = new Date('2026-10-01');

      queue('select', conversations, [convRow]);
      queue('select', conversationParticipants, [
        {
          conversationId: 'c1',
          userId: CURRENT,
          firstName: 'Me',
          lastName: 'A',
          avatar: 'a.png',
          role: 'STUDENT',
          joinedAt,
        },
        {
          conversationId: 'c1',
          userId: TARGET,
          firstName: 'Tu',
          lastName: 'B',
          avatar: null,
          role: 'TUTOR',
          joinedAt,
        },
      ]);
      queue('select', messages, [
        {
          conversationId: 'c1',
          id: 'm9',
          senderId: TARGET,
          content: 'hello',
          status: 'SENT',
          createdAt: lastAt,
        },
      ]);
      queue('select', messages, [{ conversationId: 'c1', count: '3' }]);

      const result = await service.getConversations(CURRENT);

      expect(result).toEqual([
        {
          ...convRow,
          participants: [
            {
              userId: CURRENT,
              firstName: 'Me',
              lastName: 'A',
              avatar: 'a.png',
              role: 'STUDENT',
              joinedAt,
            },
            {
              userId: TARGET,
              firstName: 'Tu',
              lastName: 'B',
              avatar: null,
              role: 'TUTOR',
              joinedAt,
            },
          ],
          lastMessage: {
            id: 'm9',
            senderId: TARGET,
            content: 'hello',
            status: 'SENT',
            createdAt: lastAt,
          },
          unreadCount: 3,
        },
      ]);
    });

    it('returns null lastMessage and zero unread for a conversation with no messages', async () => {
      queue('select', conversations, [{ id: 'c2', type: 'DIRECT', createdBy: CURRENT }]);
      queue('select', conversationParticipants, []);
      queue('select', messages, []);
      queue('select', messages, []);

      const [conv] = await service.getConversations(CURRENT);

      expect(conv.lastMessage).toBeNull();
      expect(conv.unreadCount).toBe(0);
      expect(conv.participants).toEqual([]);
    });

    it('keeps each participant and message on the conversation it belongs to', async () => {
      queue('select', conversations, [
        { id: 'c1', type: 'DIRECT' },
        { id: 'c2', type: 'DIRECT' },
      ]);
      queue('select', conversationParticipants, [
        { conversationId: 'c1', userId: 'a' },
        { conversationId: 'c2', userId: 'b' },
        { conversationId: 'c2', userId: 'c' },
      ]);
      queue('select', messages, [
        { conversationId: 'c2', id: 'm2', senderId: 'b', content: 'x', status: 'SENT' },
      ]);
      queue('select', messages, [{ conversationId: 'c1', count: 2 }]);

      const [c1, c2] = await service.getConversations(CURRENT);

      expect(c1.participants.map((p) => p.userId)).toEqual(['a']);
      expect(c1.lastMessage).toBeNull();
      expect(c1.unreadCount).toBe(2);
      expect(c2.participants.map((p) => p.userId)).toEqual(['b', 'c']);
      expect(c2.lastMessage?.id).toBe('m2');
      expect(c2.unreadCount).toBe(0);
    });
  });

  describe('getConversationById', () => {
    it('rejects a caller who is not a participant', async () => {
      queue('select', conversationParticipants, []);

      await expect(service.getConversationById(CONV_ID, CURRENT)).rejects.toThrow(
        new ForbiddenException(NOT_A_MEMBER),
      );
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('throws NotFound when the participant row exists but the conversation does not', async () => {
      queue('select', conversationParticipants, [{ userId: CURRENT }]);
      queue('select', conversations, []);

      await expect(service.getConversationById(CONV_ID, CURRENT)).rejects.toThrow(
        new NotFoundException('Conversation not found'),
      );
    });

    it('returns the conversation with participants and its last message', async () => {
      const last = {
        id: 'm1',
        senderId: TARGET,
        content: 'hi',
        status: 'READ',
        createdAt: new Date(),
      };
      const participants = [{ userId: CURRENT, firstName: 'A', lastName: 'B', role: 'STUDENT' }];
      queueConversationDetail({
        conv: [{ id: CONV_ID, type: 'DIRECT', name: null }],
        participants,
        lastMessage: [last],
      });

      await expect(service.getConversationById(CONV_ID, CURRENT)).resolves.toEqual({
        id: CONV_ID,
        type: 'DIRECT',
        name: null,
        participants,
        lastMessage: last,
      });
    });

    it('returns lastMessage as null when the conversation has no messages', async () => {
      queueConversationDetail({ participants: [], lastMessage: [] });

      const result = await service.getConversationById(CONV_ID, CURRENT);

      expect(result.lastMessage).toBeNull();
      expect(result.participants).toEqual([]);
    });
  });

  describe('createDirectConversation', () => {
    it('rejects a conversation with yourself before touching the database', async () => {
      await expect(service.createDirectConversation(CURRENT, CURRENT)).rejects.toThrow(
        new ForbiddenException('Cannot create conversation with yourself'),
      );
      expect(db.select).not.toHaveBeenCalled();
    });

    it('throws NotFound when the target user does not exist', async () => {
      queue('select', users, []);

      await expect(service.createDirectConversation(CURRENT, TARGET)).rejects.toThrow(
        new NotFoundException('Target user not found'),
      );
    });

    it('throws NotFound when the caller does not exist', async () => {
      queue('select', users, [user(TARGET, 'ADMIN')]);
      queue('select', users, []);

      await expect(service.createDirectConversation(CURRENT, TARGET)).rejects.toThrow(
        new NotFoundException('Current user not found'),
      );
    });

    it('returns the existing direct conversation without inserting a new one', async () => {
      queue('select', users, [user(TARGET, 'ADMIN')], [user(CURRENT, 'ADMIN')]);
      queue('select', conversations, [{ id: 'existing' }]); // findDirectConversation
      queueConversationDetail({ conv: [{ id: 'existing', type: 'DIRECT' }] });

      const result = await service.createDirectConversation(CURRENT, TARGET);

      expect(result).toMatchObject({ id: 'existing' });
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('creates a DIRECT conversation with both participants when none exists', async () => {
      queue('select', users, [user(TARGET, 'ADMIN')], [user(CURRENT, 'ADMIN')]);
      queue('select', conversations, []);
      queueInsertConversation();
      queueConversationDetail({ conv: [{ id: NEW_CONV_ID, type: 'DIRECT' }] });

      const result = await service.createDirectConversation(CURRENT, TARGET);

      expect(db.insert).toHaveBeenCalledWith(conversations);
      expect(result).toMatchObject({ id: NEW_CONV_ID });
    });

    it('treats a user with a null role as STUDENT when checking permissions', async () => {
      // STUDENT -> STUDENT requires a shared class; null role must follow that rule.
      queue('select', users, [user(TARGET, null)], [user(CURRENT, null)]);
      queue('select', classStudents, [{ classId: 'k1' }], [{ classId: 'k2' }]);

      await expect(service.createDirectConversation(CURRENT, TARGET)).rejects.toThrow(
        new ForbiddenException('Students can only chat with classmates'),
      );
    });

    describe('permission matrix', () => {
      const allowed: Array<[string, string]> = [
        ['ADMIN', 'STUDENT'],
        ['ADMIN', 'PARENT'],
        ['ADMIN', 'TUTOR'],
        ['ADMIN', 'ADMIN'],
        ['TUTOR', 'ADMIN'],
        ['TUTOR', 'TUTOR'],
      ];

      it.each(allowed)(
        '%s may start a direct chat with %s without extra checks',
        async (me, them) => {
          queue('select', users, [user(TARGET, them)], [user(CURRENT, me)]);
          queue('select', conversations, []);
          queueInsertConversation();
          queueConversationDetail({ conv: [{ id: NEW_CONV_ID }] });

          await expect(service.createDirectConversation(CURRENT, TARGET)).resolves.toMatchObject({
            id: NEW_CONV_ID,
          });
        },
      );

      it('lets a tutor chat with a student in one of their classes', async () => {
        queue('select', users, [user(TARGET, 'STUDENT')], [user(CURRENT, 'TUTOR')]);
        queue('select', users, [{ role: 'STUDENT', parentId: null }]); // checkTutorStudentAccess
        queue('select', classes, [{ classId: 'k1' }]);
        queue('select', classStudents, [{ classId: 'k1' }]);
        queue('select', conversations, []);
        queueInsertConversation();
        queueConversationDetail({ conv: [{ id: NEW_CONV_ID }] });

        await expect(service.createDirectConversation(CURRENT, TARGET)).resolves.toMatchObject({
          id: NEW_CONV_ID,
        });
      });

      it('lets a tutor chat with a parent whose child is in their class', async () => {
        queue('select', users, [user(TARGET, 'PARENT')], [user(CURRENT, 'TUTOR')]);
        queue('select', users, [{ role: 'PARENT', parentId: null }]);
        queue('select', users, [{ id: 'child-1' }]); // child lookup
        queue('select', classes, [{ classId: 'k1' }]);
        queue('select', classStudents, [{ classId: 'k1' }]);
        queue('select', conversations, []);
        queueInsertConversation();
        queueConversationDetail({ conv: [{ id: NEW_CONV_ID }] });

        await expect(service.createDirectConversation(CURRENT, TARGET)).resolves.toMatchObject({
          id: NEW_CONV_ID,
        });
      });

      it('rejects a tutor chatting with a student outside their classes', async () => {
        queue('select', users, [user(TARGET, 'STUDENT')], [user(CURRENT, 'TUTOR')]);
        queue('select', users, [{ role: 'STUDENT', parentId: null }]);
        queue('select', classes, [{ classId: 'k1' }]);
        queue('select', classStudents, []);

        await expect(service.createDirectConversation(CURRENT, TARGET)).rejects.toThrow(
          new ForbiddenException('Tutor can only chat with students/parents in their classes'),
        );
        expect(db.insert).not.toHaveBeenCalled();
      });

      it('rejects a tutor chatting with a user the access lookup cannot find', async () => {
        queue('select', users, [user(TARGET, 'STUDENT')], [user(CURRENT, 'TUTOR')]);
        queue('select', users, []); // target no longer exists in the lookup

        await expect(service.createDirectConversation(CURRENT, TARGET)).rejects.toThrow(
          new ForbiddenException('Tutor can only chat with students/parents in their classes'),
        );
      });

      it('rejects a tutor chatting with a parent who has no children', async () => {
        queue('select', users, [user(TARGET, 'PARENT')], [user(CURRENT, 'TUTOR')]);
        queue('select', users, [{ role: 'PARENT', parentId: null }]);
        queue('select', users, []); // no child

        await expect(service.createDirectConversation(CURRENT, TARGET)).rejects.toThrow(
          new ForbiddenException('Tutor can only chat with students/parents in their classes'),
        );
      });

      it('rejects a tutor whose classes have no enrolled students', async () => {
        queue('select', users, [user(TARGET, 'STUDENT')], [user(CURRENT, 'TUTOR')]);
        queue('select', users, [{ role: 'STUDENT', parentId: null }]);
        queue('select', classes, []); // tutor teaches no classes

        await expect(service.createDirectConversation(CURRENT, TARGET)).rejects.toThrow(
          new ForbiddenException('Tutor can only chat with students/parents in their classes'),
        );
      });

      it('lets a student chat with their tutor when they share a class', async () => {
        queue('select', users, [user(TARGET, 'TUTOR')], [user(CURRENT, 'STUDENT')]);
        queue('select', users, [{ role: 'STUDENT', parentId: null }]); // student lookup
        queue('select', classes, [{ classId: 'k1' }]); // tutor's classes
        queue('select', classStudents, [{ classId: 'k1' }]);
        queue('select', conversations, []);
        queueInsertConversation();
        queueConversationDetail({ conv: [{ id: NEW_CONV_ID }] });

        await expect(service.createDirectConversation(CURRENT, TARGET)).resolves.toMatchObject({
          id: NEW_CONV_ID,
        });
      });

      it('rejects a student chatting with a tutor they are not enrolled with', async () => {
        queue('select', users, [user(TARGET, 'TUTOR')], [user(CURRENT, 'STUDENT')]);
        queue('select', users, [{ role: 'STUDENT', parentId: null }]);
        queue('select', classes, [{ classId: 'k1' }]);
        queue('select', classStudents, []);

        await expect(service.createDirectConversation(CURRENT, TARGET)).rejects.toThrow(
          new ForbiddenException('Student can only chat with their tutors'),
        );
      });

      it('lets two students chat when they share a class', async () => {
        queue('select', users, [user(TARGET, 'STUDENT')], [user(CURRENT, 'STUDENT')]);
        queue('select', classStudents, [{ classId: 'k1' }, { classId: 'k2' }], [{ classId: 'k2' }]);
        queue('select', conversations, []);
        queueInsertConversation();
        queueConversationDetail({ conv: [{ id: NEW_CONV_ID }] });

        await expect(service.createDirectConversation(CURRENT, TARGET)).resolves.toMatchObject({
          id: NEW_CONV_ID,
        });
      });

      it('rejects two students with no shared class', async () => {
        queue('select', users, [user(TARGET, 'STUDENT')], [user(CURRENT, 'STUDENT')]);
        queue('select', classStudents, [{ classId: 'k1' }], [{ classId: 'k9' }]);

        await expect(service.createDirectConversation(CURRENT, TARGET)).rejects.toThrow(
          new ForbiddenException('Students can only chat with classmates'),
        );
      });

      it('lets a parent chat with a tutor of one of their children', async () => {
        queue('select', users, [user(TARGET, 'TUTOR')], [user(CURRENT, 'PARENT')]);
        queue('select', users, [{ id: 'child-1' }]); // children of the parent
        queue('select', classStudents, [{ classId: 'k1' }]);
        queue('select', classes, [{ id: 'k1' }]);
        queue('select', conversations, []);
        queueInsertConversation();
        queueConversationDetail({ conv: [{ id: NEW_CONV_ID }] });

        await expect(service.createDirectConversation(CURRENT, TARGET)).resolves.toMatchObject({
          id: NEW_CONV_ID,
        });
      });

      it('rejects a parent chatting with a tutor who teaches none of their children', async () => {
        queue('select', users, [user(TARGET, 'TUTOR')], [user(CURRENT, 'PARENT')]);
        queue('select', users, [{ id: 'child-1' }]);
        queue('select', classStudents, []); // child not enrolled anywhere

        await expect(service.createDirectConversation(CURRENT, TARGET)).rejects.toThrow(
          new ForbiddenException('Parent can only chat with tutors of their children'),
        );
      });

      it('rejects a parent with no children at all', async () => {
        queue('select', users, [user(TARGET, 'TUTOR')], [user(CURRENT, 'PARENT')]);
        queue('select', users, []);

        await expect(service.createDirectConversation(CURRENT, TARGET)).rejects.toThrow(
          new ForbiddenException('Parent can only chat with tutors of their children'),
        );
      });

      it('rejects a parent whose children have classes but none with this tutor', async () => {
        queue('select', users, [user(TARGET, 'TUTOR')], [user(CURRENT, 'PARENT')]);
        queue('select', users, [{ id: 'child-1' }]);
        queue('select', classStudents, [{ classId: 'k1' }]);
        queue('select', classes, []); // none of those classes belong to the tutor

        await expect(service.createDirectConversation(CURRENT, TARGET)).rejects.toThrow(
          new ForbiddenException('Parent can only chat with tutors of their children'),
        );
      });

      it.each([
        ['STUDENT', 'PARENT'],
        ['STUDENT', 'ADMIN'],
        ['PARENT', 'STUDENT'],
        ['PARENT', 'PARENT'],
        ['PARENT', 'ADMIN'],
        ['TUTOR', 'UNKNOWN_ROLE'],
      ])('%s may not start a direct chat with %s', async (me, them) => {
        queue('select', users, [user(TARGET, them)], [user(CURRENT, me)]);

        await expect(service.createDirectConversation(CURRENT, TARGET)).rejects.toThrow(
          new ForbiddenException('You do not have permission to chat with this user'),
        );
        expect(db.insert).not.toHaveBeenCalled();
      });
    });
  });

  describe('createGroupConversation', () => {
    it('inserts the creator once even when they are also listed as a participant', async () => {
      queue('select', users, [user(CURRENT, 'ADMIN'), user('a', 'STUDENT'), user('b', 'STUDENT')]);
      queue('insert', conversations, [{ id: 'g1' }]);
      queue('insert', conversationParticipants, []);
      queueConversationDetail({ conv: [{ id: 'g1', type: 'GROUP' }] });

      const result = await service.createGroupConversation(CURRENT, 'Study group', [
        CURRENT,
        'a',
        'b',
      ]);

      expect(db.insert).toHaveBeenNthCalledWith(1, conversations);
      expect(db.insert).toHaveBeenNthCalledWith(2, conversationParticipants);
      expect(result).toMatchObject({ id: 'g1', type: 'GROUP' });
    });

    it('creates the group with the creator first, followed by the other members', async () => {
      queue('select', users, [user(CURRENT, 'ADMIN'), user('a', 'STUDENT')]);
      queue('insert', conversations, [{ id: 'g2' }]);
      queue('insert', conversationParticipants, []);
      queueConversationDetail({ conv: [{ id: 'g2' }] });

      const values = jest.fn();
      db.insert.mockImplementationOnce(() => builder('insert', conversations));
      db.insert.mockImplementationOnce((table: Table) => {
        const b = builder('insert', table);
        b.values = values.mockReturnValue(b);
        return b;
      });

      await service.createGroupConversation(CURRENT, 'Study group', ['a', CURRENT]);

      expect(values).toHaveBeenCalledWith([
        { conversationId: 'g2', userId: CURRENT },
        { conversationId: 'g2', userId: 'a' },
      ]);
    });

    it('rejects a member the creator is not allowed to chat with (no insert)', async () => {
      queue('select', users, [user(CURRENT, 'PARENT'), user('a', 'STUDENT')]);

      await expect(service.createGroupConversation(CURRENT, 'Study group', ['a'])).rejects.toThrow(
        ForbiddenException,
      );
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('rejects an unknown member id (no insert)', async () => {
      queue('select', users, [user(CURRENT, 'ADMIN')]);

      await expect(
        service.createGroupConversation(CURRENT, 'Study group', ['ghost']),
      ).rejects.toThrow(NotFoundException);
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  describe('createClassConversation', () => {
    it('throws NotFound when the class does not exist', async () => {
      queue('select', classes, []);

      await expect(service.createClassConversation(CURRENT, 'missing')).rejects.toThrow(
        new NotFoundException('Class not found'),
      );
    });

    it('returns the existing class conversation without creating another', async () => {
      queue('select', classes, [{ id: 'k1', name: 'Math', tutorId: TARGET }]);
      queue('select', conversations, [{ id: 'existing-class' }]);
      queueConversationDetail({ conv: [{ id: 'existing-class', type: 'CLASS' }] });

      const result = await service.createClassConversation(CURRENT, 'k1');

      expect(result).toMatchObject({ id: 'existing-class' });
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('creates a CLASS conversation with the tutor and every enrolled student', async () => {
      queue('select', classes, [{ id: 'k1', name: 'Math', tutorId: TARGET }]);
      queue('select', conversations, []);
      queue('insert', conversations, [{ id: 'k-conv' }]);
      queue('select', classStudents, [{ studentId: 's1' }, { studentId: 's2' }]);
      queue('insert', conversationParticipants, []);
      queueConversationDetail({ conv: [{ id: 'k-conv', type: 'CLASS' }] });

      const values = jest.fn();
      db.insert.mockImplementationOnce(() => builder('insert', conversations));
      db.insert.mockImplementationOnce((table: Table) => {
        const b = builder('insert', table);
        b.values = values.mockReturnValue(b);
        return b;
      });

      const result = await service.createClassConversation(CURRENT, 'k1');

      expect(values).toHaveBeenCalledWith([
        { conversationId: 'k-conv', userId: TARGET },
        { conversationId: 'k-conv', userId: 's1' },
        { conversationId: 'k-conv', userId: 's2' },
      ]);
      expect(result).toMatchObject({ id: 'k-conv', type: 'CLASS' });
    });
  });

  describe('addParticipant', () => {
    it('rejects a caller who is not in the conversation', async () => {
      queue('select', conversationParticipants, []);

      await expect(service.addParticipant(CONV_ID, CURRENT, TARGET)).rejects.toThrow(
        new ForbiddenException(NOT_A_MEMBER),
      );
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('reports success without inserting when the user is already a participant', async () => {
      queue('select', conversationParticipants, [{ userId: CURRENT }], [{ userId: TARGET }]);

      await expect(service.addParticipant(CONV_ID, CURRENT, TARGET)).resolves.toEqual({
        message: 'User is already a participant',
      });
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('inserts the new participant when they are not yet in the conversation', async () => {
      queue('select', conversationParticipants, [{ userId: CURRENT }], []);
      queue('select', conversations, [{ type: 'GROUP' }]);
      queue('select', users, [user(CURRENT, 'ADMIN'), user(TARGET, 'STUDENT')]);
      queue('insert', conversationParticipants, []);

      await expect(service.addParticipant(CONV_ID, CURRENT, TARGET)).resolves.toEqual({
        message: 'Participant added successfully',
      });
      expect(db.insert).toHaveBeenCalledWith(conversationParticipants);
    });

    it('refuses to add members to a direct conversation', async () => {
      queue('select', conversationParticipants, [{ userId: CURRENT }]);
      queue('select', conversations, [{ type: 'DIRECT' }]);

      await expect(service.addParticipant(CONV_ID, CURRENT, TARGET)).rejects.toThrow(
        new ForbiddenException(ERROR_MESSAGES.CHAT_DIRECT_NO_ADD_PARTICIPANT),
      );
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('refuses to add a user the caller may not chat with (no insert)', async () => {
      queue('select', conversationParticipants, [{ userId: CURRENT }], []);
      queue('select', conversations, [{ type: 'GROUP' }]);
      queue('select', users, [user(CURRENT, 'PARENT'), user(TARGET, 'STUDENT')]);

      await expect(service.addParticipant(CONV_ID, CURRENT, TARGET)).rejects.toThrow(
        ForbiddenException,
      );
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  describe('markAsRead', () => {
    it('updates only the caller’s participant row with a fresh lastReadAt', async () => {
      const set = jest.fn();
      db.update.mockImplementationOnce((table: Table) => {
        const b = builder('update', table);
        b.set = set.mockReturnValue(b);
        return b;
      });
      const before = Date.now();

      await service.markAsRead(CONV_ID, CURRENT);

      expect(db.update).toHaveBeenCalledWith(conversationParticipants);
      const [payload] = set.mock.calls[0] as [{ lastReadAt: Date }];
      expect(payload.lastReadAt).toBeInstanceOf(Date);
      expect(payload.lastReadAt.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe('getChatableUsers', () => {
    const queueExistingConversations = (convIds: string[], userIds: string[]) => {
      queue(
        'select',
        conversationParticipants,
        convIds.map((conversationId) => ({ conversationId })),
      );
      if (convIds.length > 0) {
        queue(
          'select',
          conversationParticipants,
          userIds.map((id) => ({ userId: id })),
        );
      }
    };

    it('throws NotFound when the caller does not exist', async () => {
      queue('select', users, []);

      await expect(service.getChatableUsers(CURRENT)).rejects.toThrow(
        new NotFoundException('User not found'),
      );
    });

    it('lists every other active user for an ADMIN', async () => {
      queue('select', users, [user(CURRENT, 'ADMIN')]);
      queue('select', users, [user('s1', 'STUDENT'), user('t1', 'TUTOR')]);
      queueExistingConversations(['c1'], ['t1']);

      const result = await service.getChatableUsers(CURRENT);

      expect(result).toEqual([
        {
          id: 's1',
          firstName: 'First',
          lastName: 'Last',
          avatar: null,
          role: 'STUDENT',
          hasConversation: false,
        },
        {
          id: 't1',
          firstName: 'First',
          lastName: 'Last',
          avatar: null,
          role: 'TUTOR',
          hasConversation: true,
        },
      ]);
    });

    it('treats the caller’s null role as STUDENT when choosing the list', async () => {
      queue('select', users, [user(CURRENT, null)]);
      queue('select', classStudents, []); // caller's classes
      queue('select', users, [user('a1', 'ADMIN')]); // admins fallback
      queueExistingConversations([], []);

      const [entry] = await service.getChatableUsers(CURRENT);

      expect(entry.role).toBe('ADMIN');
      expect(entry).toMatchObject({ id: 'a1', hasConversation: false });
    });

    it('lists classmates, tutors and admins for a STUDENT, without self or duplicates', async () => {
      queue('select', users, [user(CURRENT, 'STUDENT')]);
      queue('select', classStudents, [{ classId: 'k1' }]); // caller's classes
      queue('select', classStudents, [{ studentId: CURRENT }, { studentId: 'mate' }]);
      queue('select', users, [user('mate', 'STUDENT'), user(CURRENT, 'STUDENT')]); // classmates
      queue('select', classes, [{ tutorId: 'tutor-1' }]);
      queue('select', users, [user('tutor-1', 'TUTOR')]);
      queue('select', users, [user('admin-1', 'ADMIN'), user('tutor-1', 'TUTOR')]); // admins
      queueExistingConversations([], []);

      const result = await service.getChatableUsers(CURRENT);

      expect(result.map((u) => u.id)).toEqual(['mate', 'tutor-1', 'admin-1']);
    });

    it('lists only admins for a STUDENT with no classes', async () => {
      queue('select', users, [user(CURRENT, 'STUDENT')]);
      queue('select', classStudents, []);
      queue('select', users, [user('admin-1', 'ADMIN')]);
      queueExistingConversations([], []);

      const result = await service.getChatableUsers(CURRENT);

      expect(result.map((u) => u.id)).toEqual(['admin-1']);
    });

    it('lists students, parents and admins for a TUTOR, deduplicated', async () => {
      queue('select', users, [user(CURRENT, 'TUTOR')]);
      queue('select', classes, [{ classId: 'k1' }]);
      queue('select', classStudents, [{ studentId: 's1' }, { studentId: 's2' }]);
      queue('select', users, [user('p1', 'PARENT')]); // parents of the students
      queue('select', users, [user('s1', 'STUDENT'), user('s2', 'STUDENT')]);
      queue('select', users, [user('admin-1', 'ADMIN'), user('s1', 'STUDENT')]); // admins
      queueExistingConversations(['c1'], [CURRENT, 'p1']);

      const result = await service.getChatableUsers(CURRENT);

      expect(result.map((u) => u.id)).toEqual(['s1', 's2', 'p1', 'admin-1']);
      expect(result.find((u) => u.id === 'p1')?.hasConversation).toBe(true);
      expect(result.find((u) => u.id === 's1')?.hasConversation).toBe(false);
    });

    it('lists only other admins for a TUTOR with no classes', async () => {
      queue('select', users, [user(CURRENT, 'TUTOR')]);
      queue('select', classes, []);
      queue('select', users, [user('admin-1', 'ADMIN')]);
      queueExistingConversations([], []);

      const result = await service.getChatableUsers(CURRENT);

      expect(result.map((u) => u.id)).toEqual(['admin-1']);
    });

    it('lists tutors and admins for a PARENT whose children are enrolled', async () => {
      queue('select', users, [user(CURRENT, 'PARENT')]);
      queue('select', users, [{ id: 'child-1' }]);
      queue('select', classStudents, [{ classId: 'k1' }]);
      queue('select', classes, [{ tutorId: 't1' }]);
      queue('select', users, [user('t1', 'TUTOR')]);
      queue('select', users, [user('admin-1', 'ADMIN')]);
      queueExistingConversations([], []);

      const result = await service.getChatableUsers(CURRENT);

      expect(result.map((u) => u.id)).toEqual(['t1', 'admin-1']);
    });

    it('lists only admins for a PARENT whose children have no classes', async () => {
      queue('select', users, [user(CURRENT, 'PARENT')]);
      queue('select', users, [{ id: 'child-1' }]);
      queue('select', classStudents, []);
      queue('select', users, [user('admin-1', 'ADMIN')]);
      queueExistingConversations([], []);

      const result = await service.getChatableUsers(CURRENT);

      expect(result.map((u) => u.id)).toEqual(['admin-1']);
    });

    it('lists only admins for a PARENT with no children', async () => {
      queue('select', users, [user(CURRENT, 'PARENT')]);
      queue('select', users, []);
      queue('select', users, [user('admin-1', 'ADMIN')]);
      queueExistingConversations([], []);

      const result = await service.getChatableUsers(CURRENT);

      expect(result.map((u) => u.id)).toEqual(['admin-1']);
    });

    it('lists a user who is both a tutor and an admin only once for a PARENT', async () => {
      queue('select', users, [user(CURRENT, 'PARENT')]);
      queue('select', users, [{ id: 'child-1' }]);
      queue('select', classStudents, [{ classId: 'k1' }]);
      queue('select', classes, [{ tutorId: 'dual-1' }]);
      queue('select', users, [user('dual-1', 'TUTOR')]);
      queue('select', users, [user('dual-1', 'ADMIN')]);
      queueExistingConversations([], []);

      const result = await service.getChatableUsers(CURRENT);

      expect(result.map((u) => u.id)).toEqual(['dual-1']);
    });

    it('reports a STUDENT role for an admin row whose role is null', async () => {
      queue('select', users, [user(CURRENT, 'ADMIN')]);
      queue('select', users, [user('no-role', null)]);
      queueExistingConversations([], []);

      const [entry] = await service.getChatableUsers(CURRENT);

      expect(entry).toMatchObject({ id: 'no-role', role: 'STUDENT' });
    });
  });
});
