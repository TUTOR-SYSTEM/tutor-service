import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, uuidList } from '../../database/prisma.service';

type UserRole = 'STUDENT' | 'ADMIN' | 'TUTOR' | 'PARENT';

const CHATABLE_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  avatar: true,
  role: true,
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof CHATABLE_USER_SELECT }>;

const LAST_MESSAGE_SELECT = {
  id: true,
  senderId: true,
  content: true,
  status: true,
  createdAt: true,
} satisfies Prisma.MessageSelect;

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  private findChatableUsers(where: Prisma.UserWhereInput): Promise<UserRow[]> {
    return this.prisma.user.findMany({ where, select: CHATABLE_USER_SELECT });
  }

  private admins(excludeUserId?: string) {
    return this.findChatableUsers({
      role: 'ADMIN',
      ...(excludeUserId && { id: { not: excludeUserId } }),
    });
  }

  private async assertParticipant(conversationId: string, userId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { id: true },
    });

    if (!participant) {
      throw new ForbiddenException('You are not a participant of this conversation');
    }
  }

  async getConversations(userId: string) {
    const convList = await this.prisma.conversation.findMany({
      where: { participants: { some: { userId } } },
      select: {
        id: true,
        type: true,
        name: true,
        classId: true,
        createdBy: true,
        lastMessageAt: true,
        createdAt: true,
      },
      // Postgres sorts NULLs first on DESC, which is what the old drizzle query returned
      orderBy: { lastMessageAt: { sort: 'desc', nulls: 'first' } },
    });

    if (convList.length === 0) return [];
    const convIds = convList.map((c) => c.id);

    // one query per child type for the whole page of conversations (no per-row round trips)
    const [participantRows, lastMessageRows, unreadRows] = await Promise.all([
      this.getParticipantDetailsMany(convIds),
      this.getLastMessages(convIds),
      this.getUnreadCountsFor(userId, convIds),
    ]);

    const participantsByConv = new Map<string, typeof participantRows>();
    for (const row of participantRows) {
      const list = participantsByConv.get(row.conversationId) ?? [];
      list.push(row);
      participantsByConv.set(row.conversationId, list);
    }
    const lastMessageByConv = new Map(lastMessageRows.map((m) => [m.conversationId, m]));
    const unreadByConv = new Map(unreadRows.map((u) => [u.conversationId, Number(u.count)]));

    return convList.map((conv) => ({
      ...conv,
      participants: (participantsByConv.get(conv.id) ?? []).map((p) => ({
        userId: p.userId,
        firstName: p.firstName,
        lastName: p.lastName,
        avatar: p.avatar,
        role: p.role,
        joinedAt: p.joinedAt,
      })),
      lastMessage: this.pickLastMessage(lastMessageByConv.get(conv.id)),
      unreadCount: unreadByConv.get(conv.id) ?? 0,
    }));
  }

  async getConversationById(conversationId: string, userId: string) {
    await this.assertParticipant(conversationId, userId);

    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });

    if (!conv) {
      throw new NotFoundException('Conversation not found');
    }

    const participants = await this.getParticipantDetails(conversationId);
    const lastMessage = await this.getLastMessage(conversationId);

    return {
      ...conv,
      participants,
      lastMessage,
    };
  }

  async createDirectConversation(userId: string, targetUserId: string) {
    if (userId === targetUserId) {
      throw new ForbiddenException('Cannot create conversation with yourself');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true },
    });

    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!currentUser) {
      throw new NotFoundException('Current user not found');
    }

    await this.validateChatPermission(
      currentUser.role ?? 'STUDENT',
      targetUser.role ?? 'STUDENT',
      userId,
      targetUserId,
    );

    const existing = await this.findDirectConversation(userId, targetUserId);
    if (existing) {
      return this.getConversationById(existing.id, userId);
    }

    const newConv = await this.prisma.conversation.create({
      data: { type: 'DIRECT', createdBy: userId },
    });

    await this.prisma.conversationParticipant.createMany({
      data: [
        { conversationId: newConv.id, userId },
        { conversationId: newConv.id, userId: targetUserId },
      ],
    });

    return this.getConversationById(newConv.id, userId);
  }

  async createGroupConversation(userId: string, name: string, participantIds: string[]) {
    const allIds = [userId, ...participantIds.filter((id) => id !== userId)];

    const newConv = await this.prisma.conversation.create({
      data: { type: 'GROUP', name, createdBy: userId },
    });

    await this.prisma.conversationParticipant.createMany({
      data: allIds.map((id) => ({ conversationId: newConv.id, userId: id })),
    });

    return this.getConversationById(newConv.id, userId);
  }

  async createClassConversation(userId: string, classId: string) {
    const classData = await this.prisma.class.findUnique({ where: { id: classId } });

    if (!classData) {
      throw new NotFoundException('Class not found');
    }

    const existing = await this.prisma.conversation.findFirst({
      where: { classId, type: 'CLASS' },
    });

    if (existing) {
      return this.getConversationById(existing.id, userId);
    }

    const newConv = await this.prisma.conversation.create({
      data: {
        type: 'CLASS',
        name: classData.name,
        classId,
        createdBy: classData.tutorId,
      },
    });

    const studentRows = await this.prisma.classStudent.findMany({
      where: { classId },
      select: { studentId: true },
    });

    const participantIds = [classData.tutorId, ...studentRows.map((s) => s.studentId)];

    await this.prisma.conversationParticipant.createMany({
      data: participantIds.map((id) => ({ conversationId: newConv.id, userId: id })),
    });

    return this.getConversationById(newConv.id, userId);
  }

  async addParticipant(conversationId: string, userId: string, newUserId: string) {
    await this.assertParticipant(conversationId, userId);

    const existing = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: newUserId } },
      select: { id: true },
    });

    if (existing) {
      return { message: 'User is already a participant' };
    }

    await this.prisma.conversationParticipant.create({
      data: { conversationId, userId: newUserId },
    });

    return { message: 'Participant added successfully' };
  }

  async markAsRead(conversationId: string, userId: string) {
    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId, userId },
      data: { lastReadAt: new Date() },
    });
  }

  private async findDirectConversation(userId1: string, userId2: string) {
    return this.prisma.conversation.findFirst({
      where: {
        type: 'DIRECT',
        AND: [
          { participants: { some: { userId: userId1 } } },
          { participants: { some: { userId: userId2 } } },
        ],
      },
    });
  }

  private pickLastMessage(
    m: Awaited<ReturnType<ConversationService['getLastMessages']>>[number] | undefined,
  ) {
    if (!m) return null;
    return {
      id: m.id,
      senderId: m.senderId,
      content: m.content,
      status: m.status,
      createdAt: m.createdAt,
    };
  }

  private async getParticipantDetailsMany(conversationIds: string[]) {
    const rows = await this.prisma.conversationParticipant.findMany({
      where: { conversationId: { in: conversationIds } },
      select: {
        conversationId: true,
        userId: true,
        joinedAt: true,
        user: { select: { firstName: true, lastName: true, avatar: true, role: true } },
      },
    });
    return rows.map(({ user, ...row }) => ({ ...row, ...user }));
  }

  // newest message per conversation in one DISTINCT ON query
  private async getLastMessages(conversationIds: string[]) {
    return this.prisma.message.findMany({
      where: { conversationId: { in: conversationIds } },
      select: { ...LAST_MESSAGE_SELECT, conversationId: true },
      distinct: ['conversationId'],
      orderBy: [{ conversationId: 'asc' }, { createdAt: 'desc' }],
    });
  }

  // unread = messages from others newer than the user's lastReadAt (all of them if never read)
  private async getUnreadCountsFor(userId: string, conversationIds: string[]) {
    return this.prisma.$queryRaw<{ conversationId: string; count: number }[]>`
      SELECT m.conversation_id AS "conversationId", count(*)::int AS count
      FROM messages m
      INNER JOIN conversation_participants cp
        ON cp.conversation_id = m.conversation_id AND cp.user_id = ${userId}::uuid
      WHERE m.conversation_id IN (${uuidList(conversationIds)})
        AND m.sender_id != ${userId}::uuid
        AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
      GROUP BY m.conversation_id`;
  }

  private async getParticipantDetails(conversationId: string) {
    const rows = await this.prisma.conversationParticipant.findMany({
      where: { conversationId },
      select: {
        userId: true,
        joinedAt: true,
        user: { select: { firstName: true, lastName: true, avatar: true, role: true } },
      },
    });
    return rows.map(({ user, ...row }) => ({ ...row, ...user }));
  }

  private async getLastMessage(conversationId: string) {
    return this.prisma.message.findFirst({
      where: { conversationId },
      select: LAST_MESSAGE_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  private async validateChatPermission(
    currentUserRole: UserRole,
    targetUserRole: UserRole,
    currentUserId: string,
    targetUserId: string,
  ) {
    if (currentUserRole === 'ADMIN') return;

    if (currentUserRole === 'TUTOR') {
      if (targetUserRole === 'ADMIN' || targetUserRole === 'TUTOR') return;

      if (targetUserRole === 'STUDENT' || targetUserRole === 'PARENT') {
        const hasAccess = await this.checkTutorStudentAccess(currentUserId, targetUserId);
        if (!hasAccess) {
          throw new ForbiddenException(
            'Tutor can only chat with students/parents in their classes',
          );
        }
        return;
      }
    }

    if (currentUserRole === 'STUDENT') {
      if (targetUserRole === 'TUTOR') {
        const hasAccess = await this.checkTutorStudentAccess(targetUserId, currentUserId);
        if (!hasAccess) {
          throw new ForbiddenException('Student can only chat with their tutors');
        }
        return;
      }

      if (targetUserRole === 'STUDENT') {
        const sameClass = await this.checkStudentsInSameClass(currentUserId, targetUserId);
        if (!sameClass) {
          throw new ForbiddenException('Students can only chat with classmates');
        }
        return;
      }
    }

    if (currentUserRole === 'PARENT') {
      if (targetUserRole === 'TUTOR') {
        const hasAccess = await this.checkParentTutorAccess(currentUserId, targetUserId);
        if (!hasAccess) {
          throw new ForbiddenException('Parent can only chat with tutors of their children');
        }
        return;
      }
    }

    throw new ForbiddenException('You do not have permission to chat with this user');
  }

  private async checkTutorStudentAccess(tutorId: string, studentOrParentId: string) {
    let studentId = studentOrParentId;

    const targetUser = await this.prisma.user.findUnique({
      where: { id: studentOrParentId },
      select: { role: true },
    });

    if (!targetUser) return false;

    if (targetUser.role === 'PARENT') {
      const child = await this.prisma.user.findFirst({
        where: { parentId: studentOrParentId },
        select: { id: true },
      });

      if (!child) return false;
      studentId = child.id;
    }

    const enrollment = await this.prisma.classStudent.findFirst({
      where: { studentId, class: { tutorId } },
      select: { id: true },
    });

    return !!enrollment;
  }

  private async checkStudentsInSameClass(student1Id: string, student2Id: string) {
    const shared = await this.prisma.classStudent.findFirst({
      where: {
        studentId: student2Id,
        class: { students: { some: { studentId: student1Id } } },
      },
      select: { id: true },
    });
    return !!shared;
  }

  private async checkParentTutorAccess(parentId: string, tutorId: string) {
    const tutorClass = await this.prisma.class.findFirst({
      where: { tutorId, students: { some: { student: { parentId } } } },
      select: { id: true },
    });
    return !!tutorClass;
  }

  async getChatableUsers(userId: string) {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!currentUser) {
      throw new NotFoundException('User not found');
    }

    const userRole = currentUser.role ?? 'STUDENT';

    let chatableUsers: UserRow[] = [];

    switch (userRole) {
      case 'ADMIN':
        chatableUsers = await this.findChatableUsers({ isActive: true, id: { not: userId } });
        break;

      case 'TUTOR': {
        const studentRows = await this.prisma.classStudent.findMany({
          where: { class: { tutorId: userId } },
          select: { studentId: true },
        });
        const studentIdList = studentRows.map((s) => s.studentId);

        if (studentIdList.length > 0) {
          const [parents, students, admins] = await Promise.all([
            this.findChatableUsers({ parentId: { in: studentIdList } }),
            this.findChatableUsers({ id: { in: studentIdList } }),
            this.admins(),
          ]);

          const seen = new Set<string>();
          chatableUsers = [...students, ...parents, ...admins].filter((u) => {
            if (seen.has(u.id)) return false;
            seen.add(u.id);
            return true;
          });
        } else {
          chatableUsers = await this.admins(userId);
        }
        break;
      }

      case 'STUDENT': {
        const classIds = (
          await this.prisma.classStudent.findMany({
            where: { studentId: userId },
            select: { classId: true },
          })
        ).map((c) => c.classId);

        if (classIds.length > 0) {
          const [classmates, tutors, admins] = await Promise.all([
            this.findChatableUsers({
              classEnrollments: { some: { classId: { in: classIds } } },
            }),
            this.findChatableUsers({ classesTaught: { some: { id: { in: classIds } } } }),
            this.admins(),
          ]);

          const seen = new Set<string>();
          chatableUsers = [...classmates, ...tutors, ...admins].filter((u) => {
            if (u.id === userId) return false;
            if (seen.has(u.id)) return false;
            seen.add(u.id);
            return true;
          });
        } else {
          chatableUsers = await this.admins(userId);
        }
        break;
      }

      case 'PARENT': {
        const tutorClasses = await this.prisma.class.findMany({
          where: { students: { some: { student: { parentId: userId } } } },
          select: { id: true },
        });

        if (tutorClasses.length > 0) {
          const classIds = tutorClasses.map((c) => c.id);
          const [tutors, admins] = await Promise.all([
            this.findChatableUsers({ classesTaught: { some: { id: { in: classIds } } } }),
            this.admins(),
          ]);

          const seen = new Set<string>();
          chatableUsers = [...tutors, ...admins].filter((u) => {
            if (seen.has(u.id)) return false;
            seen.add(u.id);
            return true;
          });
        } else {
          chatableUsers = await this.admins(userId);
        }
        break;
      }
    }

    const existingParticipants = await this.prisma.conversationParticipant.findMany({
      where: { conversation: { participants: { some: { userId } } } },
      select: { userId: true },
    });
    const existingUserIds = new Set(existingParticipants.map((p) => p.userId));

    return chatableUsers.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      avatar: u.avatar,
      role: u.role ?? 'STUDENT',
      hasConversation: existingUserIds.has(u.id),
    }));
  }
}
