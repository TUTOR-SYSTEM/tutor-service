import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConversationService } from 'src/features/chat/conversation.service';
import { createPrismaMock, PrismaMock } from '../../support/prisma.mock';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const THIRD_ID = '33333333-3333-4333-8333-333333333333';
const CONV_ID = '44444444-4444-4444-8444-444444444444';
const CLASS_ID = '55555555-5555-4555-8555-555555555555';
const NOT_A_MEMBER = 'You are not a participant of this conversation';

const person = (id: string, role: string | null = 'STUDENT') => ({
  id,
  firstName: `F-${id.slice(0, 2)}`,
  lastName: `L-${id.slice(0, 2)}`,
  avatar: null,
  role,
});

describe('ConversationService', () => {
  let service: ConversationService;
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new ConversationService(prisma as never);
  });

  const asParticipant = () =>
    prisma.conversationParticipant.findUnique.mockResolvedValue({ id: 'p1' });

  describe('getConversations', () => {
    it('returns an empty list when the user has no conversations', async () => {
      prisma.conversation.findMany.mockResolvedValue([]);

      await expect(service.getConversations(USER_ID)).resolves.toEqual([]);
      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { participants: { some: { userId: USER_ID } } } }),
      );
      expect(prisma.conversationParticipant.findMany).not.toHaveBeenCalled();
    });

    it('assembles participants, last message and unread count per conversation', async () => {
      const joinedAt = new Date('2026-10-01');
      const createdAt = new Date('2026-10-02');
      prisma.conversation.findMany.mockResolvedValue([{ id: CONV_ID, type: 'DIRECT' }]);
      prisma.conversationParticipant.findMany.mockResolvedValue([
        {
          conversationId: CONV_ID,
          userId: OTHER_ID,
          joinedAt,
          user: { firstName: 'An', lastName: 'Bui', avatar: null, role: 'TUTOR' },
        },
      ]);
      prisma.message.findMany.mockResolvedValue([
        {
          conversationId: CONV_ID,
          id: 'm1',
          senderId: OTHER_ID,
          content: 'hi',
          status: 'SENT',
          createdAt,
        },
      ]);
      prisma.$queryRaw.mockResolvedValue([{ conversationId: CONV_ID, count: '2' }]);

      const [conv] = await service.getConversations(USER_ID);

      expect(conv).toEqual({
        id: CONV_ID,
        type: 'DIRECT',
        participants: [
          {
            userId: OTHER_ID,
            firstName: 'An',
            lastName: 'Bui',
            avatar: null,
            role: 'TUTOR',
            joinedAt,
          },
        ],
        lastMessage: { id: 'm1', senderId: OTHER_ID, content: 'hi', status: 'SENT', createdAt },
        unreadCount: 2,
      });
    });

    it('asks for the newest message per conversation in one query', async () => {
      prisma.conversation.findMany.mockResolvedValue([{ id: CONV_ID }]);
      prisma.conversationParticipant.findMany.mockResolvedValue([]);
      prisma.message.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);

      await service.getConversations(USER_ID);

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { conversationId: { in: [CONV_ID] } },
          distinct: ['conversationId'],
          orderBy: [{ conversationId: 'asc' }, { createdAt: 'desc' }],
        }),
      );
    });

    it('returns null lastMessage and zero unread for a conversation with no messages', async () => {
      prisma.conversation.findMany.mockResolvedValue([{ id: CONV_ID }]);
      prisma.conversationParticipant.findMany.mockResolvedValue([]);
      prisma.message.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);

      const [conv] = await service.getConversations(USER_ID);

      expect(conv.lastMessage).toBeNull();
      expect(conv.unreadCount).toBe(0);
      expect(conv.participants).toEqual([]);
    });

    it('keeps each participant and message on the conversation it belongs to', async () => {
      const other = '66666666-6666-4666-8666-666666666666';
      prisma.conversation.findMany.mockResolvedValue([{ id: CONV_ID }, { id: other }]);
      prisma.conversationParticipant.findMany.mockResolvedValue([
        {
          conversationId: CONV_ID,
          userId: OTHER_ID,
          joinedAt: new Date(),
          user: { firstName: 'A', lastName: 'A', avatar: null, role: 'TUTOR' },
        },
        {
          conversationId: other,
          userId: THIRD_ID,
          joinedAt: new Date(),
          user: { firstName: 'B', lastName: 'B', avatar: null, role: 'STUDENT' },
        },
      ]);
      prisma.message.findMany.mockResolvedValue([
        {
          conversationId: other,
          id: 'm9',
          senderId: THIRD_ID,
          content: 'x',
          status: 'READ',
          createdAt: new Date(),
        },
      ]);
      prisma.$queryRaw.mockResolvedValue([{ conversationId: other, count: 4 }]);

      const [first, second] = await service.getConversations(USER_ID);

      expect(first.participants.map((p) => p.userId)).toEqual([OTHER_ID]);
      expect(first.lastMessage).toBeNull();
      expect(first.unreadCount).toBe(0);
      expect(second.participants.map((p) => p.userId)).toEqual([THIRD_ID]);
      expect(second.lastMessage?.id).toBe('m9');
      expect(second.unreadCount).toBe(4);
    });
  });

  describe('getConversationById', () => {
    it('rejects a caller who is not a participant', async () => {
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);

      await expect(service.getConversationById(CONV_ID, USER_ID)).rejects.toThrow(
        new ForbiddenException(NOT_A_MEMBER),
      );
    });

    it('throws NotFound when the participant row exists but the conversation does not', async () => {
      asParticipant();
      prisma.conversation.findUnique.mockResolvedValue(null);

      await expect(service.getConversationById(CONV_ID, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the conversation with participants and its last message', async () => {
      const joinedAt = new Date('2026-10-01');
      const lastMessage = { id: 'm1', content: 'hi' };
      asParticipant();
      prisma.conversation.findUnique.mockResolvedValue({ id: CONV_ID, type: 'GROUP' });
      prisma.conversationParticipant.findMany.mockResolvedValue([
        {
          userId: USER_ID,
          joinedAt,
          user: { firstName: 'An', lastName: 'Bui', avatar: null, role: 'STUDENT' },
        },
      ]);
      prisma.message.findFirst.mockResolvedValue(lastMessage);

      await expect(service.getConversationById(CONV_ID, USER_ID)).resolves.toEqual({
        id: CONV_ID,
        type: 'GROUP',
        participants: [
          {
            userId: USER_ID,
            firstName: 'An',
            lastName: 'Bui',
            avatar: null,
            role: 'STUDENT',
            joinedAt,
          },
        ],
        lastMessage,
      });
    });

    it('returns lastMessage as null when the conversation has no messages', async () => {
      asParticipant();
      prisma.conversation.findUnique.mockResolvedValue({ id: CONV_ID });
      prisma.conversationParticipant.findMany.mockResolvedValue([]);
      prisma.message.findFirst.mockResolvedValue(null);

      const result = await service.getConversationById(CONV_ID, USER_ID);

      expect(result.lastMessage).toBeNull();
    });
  });

  describe('createDirectConversation', () => {
    let getById: jest.SpyInstance;

    beforeEach(() => {
      getById = jest
        .spyOn(service, 'getConversationById')
        .mockResolvedValue({ id: CONV_ID } as never);
    });

    const users = (current: string | null, target: string | null) =>
      prisma.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === USER_ID
            ? current && { id: USER_ID, role: current }
            : target && { id: OTHER_ID, role: target },
        ),
      );

    it('rejects a conversation with yourself before touching the database', async () => {
      await expect(service.createDirectConversation(USER_ID, USER_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFound when the target user does not exist', async () => {
      users('ADMIN', null);

      await expect(service.createDirectConversation(USER_ID, OTHER_ID)).rejects.toThrow(
        new NotFoundException('Target user not found'),
      );
    });

    it('throws NotFound when the caller does not exist', async () => {
      users(null, 'ADMIN');

      await expect(service.createDirectConversation(USER_ID, OTHER_ID)).rejects.toThrow(
        new NotFoundException('Current user not found'),
      );
    });

    it('returns the existing direct conversation without inserting a new one', async () => {
      users('ADMIN', 'STUDENT');
      prisma.conversation.findFirst.mockResolvedValue({ id: CONV_ID });

      await service.createDirectConversation(USER_ID, OTHER_ID);

      expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
        where: {
          type: 'DIRECT',
          AND: [
            { participants: { some: { userId: USER_ID } } },
            { participants: { some: { userId: OTHER_ID } } },
          ],
        },
      });
      expect(prisma.conversation.create).not.toHaveBeenCalled();
      expect(getById).toHaveBeenCalledWith(CONV_ID, USER_ID);
    });

    it('creates a DIRECT conversation with both participants when none exists', async () => {
      users('ADMIN', 'STUDENT');
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue({ id: CONV_ID });

      await service.createDirectConversation(USER_ID, OTHER_ID);

      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: { type: 'DIRECT', createdBy: USER_ID },
      });
      expect(prisma.conversationParticipant.createMany).toHaveBeenCalledWith({
        data: [
          { conversationId: CONV_ID, userId: USER_ID },
          { conversationId: CONV_ID, userId: OTHER_ID },
        ],
      });
    });

    it('treats a user with a null role as STUDENT when checking permissions', async () => {
      users(null as never, 'TUTOR');
      prisma.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === USER_ID ? { id: USER_ID, role: null } : { id: OTHER_ID, role: 'TUTOR' },
        ),
      );
      jest.spyOn(service as never, 'checkTutorStudentAccess').mockResolvedValue(false as never);

      await expect(service.createDirectConversation(USER_ID, OTHER_ID)).rejects.toThrow(
        'Student can only chat with their tutors',
      );
    });

    describe('permission matrix', () => {
      const run = (
        current: string,
        target: string,
        access: Partial<{ tutorStudent: boolean; sameClass: boolean; parentTutor: boolean }> = {},
      ) => {
        users(current, target);
        prisma.conversation.findFirst.mockResolvedValue({ id: CONV_ID });
        jest
          .spyOn(service as never, 'checkTutorStudentAccess')
          .mockResolvedValue((access.tutorStudent ?? false) as never);
        jest
          .spyOn(service as never, 'checkStudentsInSameClass')
          .mockResolvedValue((access.sameClass ?? false) as never);
        jest
          .spyOn(service as never, 'checkParentTutorAccess')
          .mockResolvedValue((access.parentTutor ?? false) as never);
        return service.createDirectConversation(USER_ID, OTHER_ID);
      };

      it.each([
        ['ADMIN', 'STUDENT', {}],
        ['ADMIN', 'PARENT', {}],
        ['TUTOR', 'ADMIN', {}],
        ['TUTOR', 'TUTOR', {}],
        ['TUTOR', 'STUDENT', { tutorStudent: true }],
        ['TUTOR', 'PARENT', { tutorStudent: true }],
        ['STUDENT', 'TUTOR', { tutorStudent: true }],
        ['STUDENT', 'STUDENT', { sameClass: true }],
        ['PARENT', 'TUTOR', { parentTutor: true }],
      ])('allows %s -> %s', async (current, target, access) => {
        await expect(run(current, target, access)).resolves.toEqual({ id: CONV_ID });
      });

      it.each([
        ['TUTOR', 'STUDENT', 'Tutor can only chat with students/parents in their classes'],
        ['STUDENT', 'TUTOR', 'Student can only chat with their tutors'],
        ['STUDENT', 'STUDENT', 'Students can only chat with classmates'],
        ['PARENT', 'TUTOR', 'Parent can only chat with tutors of their children'],
        ['STUDENT', 'ADMIN', 'You do not have permission to chat with this user'],
        ['PARENT', 'STUDENT', 'You do not have permission to chat with this user'],
      ])('rejects %s -> %s without the required access', async (current, target, message) => {
        await expect(run(current, target)).rejects.toThrow(new ForbiddenException(message));
      });
    });
  });

  describe('access lookups', () => {
    const check = (name: string, ...args: string[]) =>
      (service as never as Record<string, (...a: string[]) => Promise<boolean>>)[name](...args);

    it('tutor -> student: true when the student is enrolled in one of the tutor classes', async () => {
      prisma.user.findUnique.mockResolvedValue({ role: 'STUDENT' });
      prisma.classStudent.findFirst.mockResolvedValue({ id: 'cs' });

      await expect(check('checkTutorStudentAccess', USER_ID, OTHER_ID)).resolves.toBe(true);
      expect(prisma.classStudent.findFirst).toHaveBeenCalledWith({
        where: { studentId: OTHER_ID, class: { tutorId: USER_ID } },
        select: { id: true },
      });
    });

    it('tutor -> parent: resolves the parent to a child before checking enrollment', async () => {
      prisma.user.findUnique.mockResolvedValue({ role: 'PARENT' });
      prisma.user.findFirst.mockResolvedValue({ id: THIRD_ID });
      prisma.classStudent.findFirst.mockResolvedValue({ id: 'cs' });

      await expect(check('checkTutorStudentAccess', USER_ID, OTHER_ID)).resolves.toBe(true);
      expect(prisma.classStudent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { studentId: THIRD_ID, class: { tutorId: USER_ID } } }),
      );
    });

    it('tutor -> parent without children is denied', async () => {
      prisma.user.findUnique.mockResolvedValue({ role: 'PARENT' });
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(check('checkTutorStudentAccess', USER_ID, OTHER_ID)).resolves.toBe(false);
      expect(prisma.classStudent.findFirst).not.toHaveBeenCalled();
    });

    it('tutor -> unknown user is denied', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(check('checkTutorStudentAccess', USER_ID, OTHER_ID)).resolves.toBe(false);
    });

    it('tutor -> student outside their classes is denied', async () => {
      prisma.user.findUnique.mockResolvedValue({ role: 'STUDENT' });
      prisma.classStudent.findFirst.mockResolvedValue(null);

      await expect(check('checkTutorStudentAccess', USER_ID, OTHER_ID)).resolves.toBe(false);
    });

    it('two students are classmates when they share a class', async () => {
      prisma.classStudent.findFirst.mockResolvedValueOnce({ id: 'cs' }).mockResolvedValueOnce(null);

      await expect(check('checkStudentsInSameClass', USER_ID, OTHER_ID)).resolves.toBe(true);
      await expect(check('checkStudentsInSameClass', USER_ID, OTHER_ID)).resolves.toBe(false);
      expect(prisma.classStudent.findFirst).toHaveBeenCalledWith({
        where: { studentId: OTHER_ID, class: { students: { some: { studentId: USER_ID } } } },
        select: { id: true },
      });
    });

    it('a parent reaches a tutor teaching one of their children', async () => {
      prisma.class.findFirst.mockResolvedValueOnce({ id: CLASS_ID }).mockResolvedValueOnce(null);

      await expect(check('checkParentTutorAccess', USER_ID, OTHER_ID)).resolves.toBe(true);
      await expect(check('checkParentTutorAccess', USER_ID, OTHER_ID)).resolves.toBe(false);
      expect(prisma.class.findFirst).toHaveBeenCalledWith({
        where: { tutorId: OTHER_ID, students: { some: { student: { parentId: USER_ID } } } },
        select: { id: true },
      });
    });
  });

  describe('createGroupConversation', () => {
    beforeEach(() => {
      prisma.conversation.create.mockResolvedValue({ id: CONV_ID });
      jest.spyOn(service, 'getConversationById').mockResolvedValue({ id: CONV_ID } as never);
    });

    it('inserts the creator once even when they are also listed as a participant', async () => {
      await service.createGroupConversation(USER_ID, 'Study', [USER_ID, OTHER_ID]);

      expect(prisma.conversationParticipant.createMany).toHaveBeenCalledWith({
        data: [
          { conversationId: CONV_ID, userId: USER_ID },
          { conversationId: CONV_ID, userId: OTHER_ID },
        ],
      });
    });

    it('creates the group with the creator first, followed by the other members', async () => {
      await service.createGroupConversation(USER_ID, 'Study', [OTHER_ID, THIRD_ID]);

      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: { type: 'GROUP', name: 'Study', createdBy: USER_ID },
      });
      const { data } = prisma.conversationParticipant.createMany.mock.calls[0][0];
      expect(data.map((d: { userId: string }) => d.userId)).toEqual([USER_ID, OTHER_ID, THIRD_ID]);
    });
  });

  describe('createClassConversation', () => {
    beforeEach(() => {
      jest.spyOn(service, 'getConversationById').mockResolvedValue({ id: CONV_ID } as never);
    });

    it('throws NotFound when the class does not exist', async () => {
      prisma.class.findUnique.mockResolvedValue(null);

      await expect(service.createClassConversation(USER_ID, CLASS_ID)).rejects.toThrow(
        new NotFoundException('Class not found'),
      );
    });

    it('returns the existing class conversation without creating another', async () => {
      prisma.class.findUnique.mockResolvedValue({ id: CLASS_ID, name: 'Math', tutorId: USER_ID });
      prisma.conversation.findFirst.mockResolvedValue({ id: CONV_ID });

      await service.createClassConversation(USER_ID, CLASS_ID);

      expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
        where: { classId: CLASS_ID, type: 'CLASS' },
      });
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });

    it('creates a CLASS conversation with the tutor and every enrolled student', async () => {
      prisma.class.findUnique.mockResolvedValue({ id: CLASS_ID, name: 'Math', tutorId: USER_ID });
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue({ id: CONV_ID });
      prisma.classStudent.findMany.mockResolvedValue([
        { studentId: OTHER_ID },
        { studentId: THIRD_ID },
      ]);

      await service.createClassConversation(USER_ID, CLASS_ID);

      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: { type: 'CLASS', name: 'Math', classId: CLASS_ID, createdBy: USER_ID },
      });
      expect(prisma.conversationParticipant.createMany).toHaveBeenCalledWith({
        data: [USER_ID, OTHER_ID, THIRD_ID].map((userId) => ({ conversationId: CONV_ID, userId })),
      });
    });
  });

  describe('addParticipant', () => {
    it('rejects a caller who is not in the conversation', async () => {
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);

      await expect(service.addParticipant(CONV_ID, USER_ID, OTHER_ID)).rejects.toThrow(
        new ForbiddenException(NOT_A_MEMBER),
      );
    });

    it('reports success without inserting when the user is already a participant', async () => {
      prisma.conversationParticipant.findUnique.mockResolvedValue({ id: 'p' });

      await expect(service.addParticipant(CONV_ID, USER_ID, OTHER_ID)).resolves.toEqual({
        message: 'User is already a participant',
      });
      expect(prisma.conversationParticipant.create).not.toHaveBeenCalled();
    });

    it('inserts the new participant when they are not yet in the conversation', async () => {
      prisma.conversationParticipant.findUnique
        .mockResolvedValueOnce({ id: 'caller' })
        .mockResolvedValueOnce(null);

      await expect(service.addParticipant(CONV_ID, USER_ID, OTHER_ID)).resolves.toEqual({
        message: 'Participant added successfully',
      });
      expect(prisma.conversationParticipant.create).toHaveBeenCalledWith({
        data: { conversationId: CONV_ID, userId: OTHER_ID },
      });
    });
  });

  describe('markAsRead', () => {
    it('updates only the caller’s participant row with a fresh lastReadAt', async () => {
      await service.markAsRead(CONV_ID, USER_ID);

      expect(prisma.conversationParticipant.updateMany).toHaveBeenCalledWith({
        where: { conversationId: CONV_ID, userId: USER_ID },
        data: { lastReadAt: expect.any(Date) },
      });
    });
  });

  describe('getChatableUsers', () => {
    const caller = (role: string | null) =>
      prisma.user.findUnique.mockResolvedValue({ id: USER_ID, role });

    // route user.findMany by the distinguishing part of the `where`
    const lists = (map: (where: Record<string, unknown>) => unknown[]) =>
      prisma.user.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(map(where)),
      );

    beforeEach(() => {
      prisma.conversationParticipant.findMany.mockResolvedValue([]);
    });

    it('throws NotFound when the caller does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getChatableUsers(USER_ID)).rejects.toThrow(
        new NotFoundException('User not found'),
      );
    });

    it('lists every other active user for an ADMIN and flags existing conversations', async () => {
      caller('ADMIN');
      prisma.user.findMany.mockResolvedValue([person(OTHER_ID), person(THIRD_ID)]);
      prisma.conversationParticipant.findMany.mockResolvedValue([{ userId: OTHER_ID }]);

      const result = await service.getChatableUsers(USER_ID);

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true, id: { not: USER_ID } } }),
      );
      expect(result.map((u) => [u.id, u.hasConversation])).toEqual([
        [OTHER_ID, true],
        [THIRD_ID, false],
      ]);
    });

    it('treats the caller’s null role as STUDENT when choosing the list', async () => {
      caller(null);
      prisma.classStudent.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([person(OTHER_ID, 'ADMIN')]);

      await service.getChatableUsers(USER_ID);

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { role: 'ADMIN', id: { not: USER_ID } } }),
      );
    });

    it('lists classmates, tutors and admins for a STUDENT, without self or duplicates', async () => {
      caller('STUDENT');
      prisma.classStudent.findMany.mockResolvedValue([{ classId: CLASS_ID }]);
      lists((where) => {
        if ('classEnrollments' in where) return [person(USER_ID), person(OTHER_ID)];
        if ('classesTaught' in where) return [person(THIRD_ID, 'TUTOR')];
        return [person(THIRD_ID, 'TUTOR'), person('77777777-7777-4777-8777-777777777777', 'ADMIN')];
      });

      const result = await service.getChatableUsers(USER_ID);

      expect(result.map((u) => u.id)).toEqual([
        OTHER_ID,
        THIRD_ID,
        '77777777-7777-4777-8777-777777777777',
      ]);
    });

    it('lists only other admins for a STUDENT with no classes', async () => {
      caller('STUDENT');
      prisma.classStudent.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([person(OTHER_ID, 'ADMIN')]);

      const result = await service.getChatableUsers(USER_ID);

      expect(result.map((u) => u.id)).toEqual([OTHER_ID]);
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    });

    it('lists students, parents and admins for a TUTOR, deduplicated', async () => {
      caller('TUTOR');
      prisma.classStudent.findMany.mockResolvedValue([{ studentId: OTHER_ID }]);
      lists((where) => {
        if ('parentId' in where) return [person(THIRD_ID, 'PARENT')];
        if ('id' in where) return [person(OTHER_ID)];
        return [
          person(THIRD_ID, 'PARENT'),
          person('88888888-8888-4888-8888-888888888888', 'ADMIN'),
        ];
      });

      const result = await service.getChatableUsers(USER_ID);

      expect(result.map((u) => u.id)).toEqual([
        OTHER_ID,
        THIRD_ID,
        '88888888-8888-4888-8888-888888888888',
      ]);
    });

    it('lists only other admins for a TUTOR with no students', async () => {
      caller('TUTOR');
      prisma.classStudent.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([person(OTHER_ID, 'ADMIN')]);

      const result = await service.getChatableUsers(USER_ID);

      expect(result.map((u) => u.id)).toEqual([OTHER_ID]);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { role: 'ADMIN', id: { not: USER_ID } } }),
      );
    });

    it('lists tutors and admins for a PARENT whose children are enrolled', async () => {
      caller('PARENT');
      prisma.class.findMany.mockResolvedValue([{ id: CLASS_ID }]);
      lists((where) =>
        'classesTaught' in where ? [person(OTHER_ID, 'TUTOR')] : [person(THIRD_ID, 'ADMIN')],
      );

      const result = await service.getChatableUsers(USER_ID);

      expect(result.map((u) => u.id)).toEqual([OTHER_ID, THIRD_ID]);
    });

    it('lists only other admins for a PARENT whose children have no classes', async () => {
      caller('PARENT');
      prisma.class.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([person(OTHER_ID, 'ADMIN')]);

      const result = await service.getChatableUsers(USER_ID);

      expect(result.map((u) => u.id)).toEqual([OTHER_ID]);
    });

    it('lists a user who is both a tutor and an admin only once for a PARENT', async () => {
      caller('PARENT');
      prisma.class.findMany.mockResolvedValue([{ id: CLASS_ID }]);
      prisma.user.findMany.mockResolvedValue([person(OTHER_ID, 'ADMIN')]);

      const result = await service.getChatableUsers(USER_ID);

      expect(result.map((u) => u.id)).toEqual([OTHER_ID]);
    });

    it('reports a STUDENT role for a row whose role is null', async () => {
      caller('ADMIN');
      prisma.user.findMany.mockResolvedValue([person(OTHER_ID, null)]);

      const [user] = await service.getChatableUsers(USER_ID);

      expect(user.role).toBe('STUDENT');
    });
  });
});
