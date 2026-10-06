import { Inject, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DRIZZLE } from '../../database/database.module';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import {
  conversations,
  conversationParticipants,
  messages,
  users,
  classes,
  classStudents,
} from 'src/database/schema';

type UserRole = 'STUDENT' | 'ADMIN' | 'TUTOR' | 'PARENT';

type UserRow = {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
  role: string | null;
};

@Injectable()
export class ConversationService {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<Record<string, never>>) {}

  async getConversations(userId: string) {
    const convList = await this.db
      .select({
        id: conversations.id,
        type: conversations.type,
        name: conversations.name,
        classId: conversations.classId,
        createdBy: conversations.createdBy,
        lastMessageAt: conversations.lastMessageAt,
        createdAt: conversations.createdAt,
      })
      .from(conversations)
      .where(
        inArray(
          conversations.id,
          this.db
            .select({ id: conversationParticipants.conversationId })
            .from(conversationParticipants)
            .where(eq(conversationParticipants.userId, userId)),
        ),
      )
      .orderBy(desc(conversations.lastMessageAt));

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
    const participant = await this.db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      )
      .limit(1);

    if (participant.length === 0) {
      throw new ForbiddenException('You are not a participant of this conversation');
    }

    const conv = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (conv.length === 0) {
      throw new NotFoundException('Conversation not found');
    }

    const participants = await this.getParticipantDetails(conversationId);
    const lastMessage = await this.getLastMessage(conversationId);

    return {
      ...conv[0],
      participants,
      lastMessage,
    };
  }

  async createDirectConversation(userId: string, targetUserId: string) {
    if (userId === targetUserId) {
      throw new ForbiddenException('Cannot create conversation with yourself');
    }

    const targetUser = await this.db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (targetUser.length === 0) {
      throw new NotFoundException('Target user not found');
    }

    const currentUser = await this.db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (currentUser.length === 0) {
      throw new NotFoundException('Current user not found');
    }

    await this.validateChatPermission(
      currentUser[0].role ?? 'STUDENT',
      targetUser[0].role ?? 'STUDENT',
      userId,
      targetUserId,
    );

    const existing = await this.findDirectConversation(userId, targetUserId);
    if (existing) {
      return this.getConversationById(existing.id, userId);
    }

    const [newConv] = await this.db
      .insert(conversations)
      .values({
        type: 'DIRECT',
        createdBy: userId,
      })
      .returning();

    await this.db.insert(conversationParticipants).values([
      { conversationId: newConv.id, userId },
      { conversationId: newConv.id, userId: targetUserId },
    ]);

    return this.getConversationById(newConv.id, userId);
  }

  async createGroupConversation(userId: string, name: string, participantIds: string[]) {
    const allIds = [userId, ...participantIds.filter((id) => id !== userId)];

    const [newConv] = await this.db
      .insert(conversations)
      .values({
        type: 'GROUP',
        name,
        createdBy: userId,
      })
      .returning();

    await this.db
      .insert(conversationParticipants)
      .values(allIds.map((id) => ({ conversationId: newConv.id, userId: id })));

    return this.getConversationById(newConv.id, userId);
  }

  async createClassConversation(userId: string, classId: string) {
    const classData = await this.db.select().from(classes).where(eq(classes.id, classId)).limit(1);

    if (classData.length === 0) {
      throw new NotFoundException('Class not found');
    }

    const existing = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.classId, classId), eq(conversations.type, 'CLASS')))
      .limit(1);

    if (existing.length > 0) {
      return this.getConversationById(existing[0].id, userId);
    }

    const [newConv] = await this.db
      .insert(conversations)
      .values({
        type: 'CLASS',
        name: classData[0].name,
        classId,
        createdBy: classData[0].tutorId,
      })
      .returning();

    const tutorId = classData[0].tutorId;

    const studentRows = await this.db
      .select({ studentId: classStudents.studentId })
      .from(classStudents)
      .where(eq(classStudents.classId, classId));

    const participantIds = [tutorId, ...studentRows.map((s) => s.studentId)];

    await this.db
      .insert(conversationParticipants)
      .values(participantIds.map((id) => ({ conversationId: newConv.id, userId: id })));

    return this.getConversationById(newConv.id, userId);
  }

  async addParticipant(conversationId: string, userId: string, newUserId: string) {
    const participant = await this.db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      )
      .limit(1);

    if (participant.length === 0) {
      throw new ForbiddenException('You are not a participant of this conversation');
    }

    const existing = await this.db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, newUserId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return { message: 'User is already a participant' };
    }

    await this.db.insert(conversationParticipants).values({
      conversationId,
      userId: newUserId,
    });

    return { message: 'Participant added successfully' };
  }

  async markAsRead(conversationId: string, userId: string) {
    await this.db
      .update(conversationParticipants)
      .set({ lastReadAt: new Date() })
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      );
  }

  private async findDirectConversation(userId1: string, userId2: string) {
    const memberOf = (userId: string) =>
      this.db
        .select({ id: conversationParticipants.conversationId })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.userId, userId));

    const [conv] = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.type, 'DIRECT'),
          inArray(conversations.id, memberOf(userId1)),
          inArray(conversations.id, memberOf(userId2)),
        ),
      )
      .limit(1);

    return conv ?? null;
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
    return this.db
      .select({
        conversationId: conversationParticipants.conversationId,
        userId: conversationParticipants.userId,
        firstName: users.firstName,
        lastName: users.lastName,
        avatar: users.avatar,
        role: users.role,
        joinedAt: conversationParticipants.joinedAt,
      })
      .from(conversationParticipants)
      .innerJoin(users, eq(conversationParticipants.userId, users.id))
      .where(inArray(conversationParticipants.conversationId, conversationIds));
  }

  // newest message per conversation in one DISTINCT ON query
  private async getLastMessages(conversationIds: string[]) {
    return this.db
      .selectDistinctOn([messages.conversationId], {
        conversationId: messages.conversationId,
        id: messages.id,
        senderId: messages.senderId,
        content: messages.content,
        status: messages.status,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(inArray(messages.conversationId, conversationIds))
      .orderBy(messages.conversationId, desc(messages.createdAt));
  }

  // unread = messages from others newer than the user's lastReadAt (all of them if never read)
  private async getUnreadCountsFor(userId: string, conversationIds: string[]) {
    return this.db
      .select({
        conversationId: messages.conversationId,
        count: sql<number>`count(*)::int`,
      })
      .from(messages)
      .innerJoin(
        conversationParticipants,
        and(
          eq(conversationParticipants.conversationId, messages.conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      )
      .where(
        and(
          inArray(messages.conversationId, conversationIds),
          sql`${messages.senderId} != ${userId}`,
          sql`(${conversationParticipants.lastReadAt} is null or ${messages.createdAt} > ${conversationParticipants.lastReadAt})`,
        ),
      )
      .groupBy(messages.conversationId);
  }

  private async getParticipantDetails(conversationId: string) {
    const rows = await this.db
      .select({
        userId: conversationParticipants.userId,
        firstName: users.firstName,
        lastName: users.lastName,
        avatar: users.avatar,
        role: users.role,
        joinedAt: conversationParticipants.joinedAt,
      })
      .from(conversationParticipants)
      .innerJoin(users, eq(conversationParticipants.userId, users.id))
      .where(eq(conversationParticipants.conversationId, conversationId));

    return rows;
  }

  private async getLastMessage(conversationId: string) {
    const rows = await this.db
      .select({
        id: messages.id,
        senderId: messages.senderId,
        content: messages.content,
        status: messages.status,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(1);

    return rows[0] ?? null;
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

    const targetUser = await this.db
      .select({ role: users.role, parentId: users.parentId })
      .from(users)
      .where(eq(users.id, studentOrParentId))
      .limit(1);

    if (targetUser.length === 0) return false;

    if (targetUser[0].role === 'PARENT') {
      const child = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.parentId, studentOrParentId))
        .limit(1);

      if (child.length === 0) return false;
      studentId = child[0].id;
    }

    const tutorClasses = await this.db
      .select({ classId: classes.id })
      .from(classes)
      .where(eq(classes.tutorId, tutorId));

    if (tutorClasses.length === 0) return false;

    const classIds = tutorClasses.map((c) => c.classId);

    const enrollment = await this.db
      .select()
      .from(classStudents)
      .where(
        and(sql`${classStudents.classId} IN ${classIds}`, eq(classStudents.studentId, studentId)),
      )
      .limit(1);

    return enrollment.length > 0;
  }

  private async checkStudentsInSameClass(student1Id: string, student2Id: string) {
    const student1Classes = await this.db
      .select({ classId: classStudents.classId })
      .from(classStudents)
      .where(eq(classStudents.studentId, student1Id));

    const student2Classes = await this.db
      .select({ classId: classStudents.classId })
      .from(classStudents)
      .where(eq(classStudents.studentId, student2Id));

    const s1ClassIds = new Set(student1Classes.map((c) => c.classId));
    return student2Classes.some((c) => s1ClassIds.has(c.classId));
  }

  private async checkParentTutorAccess(parentId: string, tutorId: string) {
    const children = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.parentId, parentId));

    if (children.length === 0) return false;

    const childIds = children.map((c) => c.id);

    const enrollments = await this.db
      .select({ classId: classStudents.classId })
      .from(classStudents)
      .where(sql`${classStudents.studentId} IN ${childIds}`);

    if (enrollments.length === 0) return false;

    const classIds = enrollments.map((e) => e.classId);

    const tutorClass = await this.db
      .select()
      .from(classes)
      .where(and(sql`${classes.id} IN ${classIds}`, eq(classes.tutorId, tutorId)))
      .limit(1);

    return tutorClass.length > 0;
  }

  async getChatableUsers(userId: string) {
    const currentUser = await this.db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (currentUser.length === 0) {
      throw new NotFoundException('User not found');
    }

    const userRole = currentUser[0].role ?? 'STUDENT';

    let chatableUsers: UserRow[] = [];

    switch (userRole) {
      case 'ADMIN':
        chatableUsers = await this.db
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            avatar: users.avatar,
            role: users.role,
          })
          .from(users)
          .where(and(eq(users.isActive, true), sql`${users.id} != ${userId}`));
        break;

      case 'TUTOR': {
        const tutorClasses = await this.db
          .select({ classId: classes.id })
          .from(classes)
          .where(eq(classes.tutorId, userId));

        const classIds = tutorClasses.map((c) => c.classId);

        if (classIds.length > 0) {
          const studentIds = await this.db
            .select({ studentId: classStudents.studentId })
            .from(classStudents)
            .where(sql`${classStudents.classId} IN ${classIds}`);

          const studentIdList = studentIds.map((s) => s.studentId);

          const parents = await this.db
            .select({
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
              avatar: users.avatar,
              role: users.role,
            })
            .from(users)
            .where(sql`${users.parentId} IN ${studentIdList}`);

          const students = await this.db
            .select({
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
              avatar: users.avatar,
              role: users.role,
            })
            .from(users)
            .where(sql`${users.id} IN ${studentIdList}`);

          const admins = await this.db
            .select({
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
              avatar: users.avatar,
              role: users.role,
            })
            .from(users)
            .where(eq(users.role, 'ADMIN'));

          const seen = new Set<string>();
          chatableUsers = [...students, ...parents, ...admins].filter((u) => {
            if (seen.has(u.id)) return false;
            seen.add(u.id);
            return true;
          });
        } else {
          chatableUsers = await this.db
            .select({
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
              avatar: users.avatar,
              role: users.role,
            })
            .from(users)
            .where(and(eq(users.role, 'ADMIN'), sql`${users.id} != ${userId}`));
        }
        break;
      }

      case 'STUDENT': {
        const studentClasses = await this.db
          .select({ classId: classStudents.classId })
          .from(classStudents)
          .where(eq(classStudents.studentId, userId));

        const classIds = studentClasses.map((c) => c.classId);

        if (classIds.length > 0) {
          const classmateIds = await this.db
            .select({ studentId: classStudents.studentId })
            .from(classStudents)
            .where(sql`${classStudents.classId} IN ${classIds}`);

          const classmates = await this.db
            .select({
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
              avatar: users.avatar,
              role: users.role,
            })
            .from(users)
            .where(sql`${users.id} IN ${classmateIds.map((s) => s.studentId)}`);

          const tutorIds = await this.db
            .select({ tutorId: classes.tutorId })
            .from(classes)
            .where(sql`${classes.id} IN ${classIds}`);

          const tutors = await this.db
            .select({
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
              avatar: users.avatar,
              role: users.role,
            })
            .from(users)
            .where(sql`${users.id} IN ${tutorIds.map((t) => t.tutorId)}`);

          const admins = await this.db
            .select({
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
              avatar: users.avatar,
              role: users.role,
            })
            .from(users)
            .where(eq(users.role, 'ADMIN'));

          const seen = new Set<string>();
          chatableUsers = [...classmates, ...tutors, ...admins].filter((u) => {
            if (u.id === userId) return false;
            if (seen.has(u.id)) return false;
            seen.add(u.id);
            return true;
          });
        } else {
          chatableUsers = await this.db
            .select({
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
              avatar: users.avatar,
              role: users.role,
            })
            .from(users)
            .where(and(eq(users.role, 'ADMIN'), sql`${users.id} != ${userId}`));
        }
        break;
      }

      case 'PARENT': {
        const children = await this.db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.parentId, userId));

        const childIds = children.map((c) => c.id);

        if (childIds.length > 0) {
          const childClassIds = await this.db
            .select({ classId: classStudents.classId })
            .from(classStudents)
            .where(sql`${classStudents.studentId} IN ${childIds}`);

          const classIds = childClassIds.map((c) => c.classId);

          if (classIds.length > 0) {
            const tutorIds = await this.db
              .select({ tutorId: classes.tutorId })
              .from(classes)
              .where(sql`${classes.id} IN ${classIds}`);

            const tutors = await this.db
              .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                avatar: users.avatar,
                role: users.role,
              })
              .from(users)
              .where(sql`${users.id} IN ${tutorIds.map((t) => t.tutorId)}`);

            const admins = await this.db
              .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                avatar: users.avatar,
                role: users.role,
              })
              .from(users)
              .where(eq(users.role, 'ADMIN'));

            const seen = new Set<string>();
            chatableUsers = [...tutors, ...admins].filter((u) => {
              if (seen.has(u.id)) return false;
              seen.add(u.id);
              return true;
            });
          } else {
            chatableUsers = await this.db
              .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                avatar: users.avatar,
                role: users.role,
              })
              .from(users)
              .where(and(eq(users.role, 'ADMIN'), sql`${users.id} != ${userId}`));
          }
        } else {
          chatableUsers = await this.db
            .select({
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
              avatar: users.avatar,
              role: users.role,
            })
            .from(users)
            .where(and(eq(users.role, 'ADMIN'), sql`${users.id} != ${userId}`));
        }
        break;
      }
    }

    const existingConvs = await this.db
      .select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.userId, userId));

    const existingConvIds = existingConvs.map((r) => r.conversationId);

    const existingUserIds = new Set<string>();

    if (existingConvIds.length > 0) {
      const existingParticipants = await this.db
        .select({ userId: conversationParticipants.userId })
        .from(conversationParticipants)
        .where(sql`${conversationParticipants.conversationId} IN ${existingConvIds}`);

      existingParticipants.forEach((p) => existingUserIds.add(p.userId));
    }

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
