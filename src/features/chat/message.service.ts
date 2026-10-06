import { Inject, Injectable, ForbiddenException } from '@nestjs/common';
import { DRIZZLE } from '../../database/database.module';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { messages, conversationParticipants, conversations } from '@tutor/gateway/schema';

@Injectable()
export class MessageService {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<Record<string, never>>) {}

  async getMessages(conversationId: string, userId: string, limit = 50, before?: string) {
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

    const conditions = [eq(messages.conversationId, conversationId)];

    if (before) {
      const beforeMsg = await this.db
        .select({ createdAt: messages.createdAt })
        .from(messages)
        .where(eq(messages.id, before))
        .limit(1);

      if (beforeMsg.length > 0) {
        conditions.push(sql`${messages.createdAt} < ${beforeMsg[0].createdAt}`);
      }
    }

    const result = await this.db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        senderId: messages.senderId,
        content: messages.content,
        status: messages.status,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt))
      .limit(limit);

    return result.reverse();
  }

  async createMessage(conversationId: string, senderId: string, content: string) {
    const participant = await this.db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, senderId),
        ),
      )
      .limit(1);

    if (participant.length === 0) {
      throw new ForbiddenException('You are not a participant of this conversation');
    }

    const [newMessage] = await this.db
      .insert(messages)
      .values({
        conversationId,
        senderId,
        content,
        status: 'SENT',
      })
      .returning();

    await this.db
      .update(conversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(conversations.id, conversationId));

    return newMessage;
  }

  async updateMessageStatus(messageId: string, status: 'DELIVERED' | 'READ') {
    const [updated] = await this.db
      .update(messages)
      .set({ status })
      .where(eq(messages.id, messageId))
      .returning();

    return updated;
  }

  async markConversationAsRead(conversationId: string, userId: string) {
    await this.db
      .update(conversationParticipants)
      .set({ lastReadAt: new Date() })
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      );

    await this.db
      .update(messages)
      .set({ status: 'READ' })
      .where(
        and(
          eq(messages.conversationId, conversationId),
          sql`${messages.senderId} != ${userId}`,
          sql`${messages.status} != 'READ'`,
        ),
      );
  }

  async getUnreadCounts(userId: string) {
    // one grouped query across all of the user's conversations (was 1+N)
    const rows = await this.db
      .select({
        conversationId: conversationParticipants.conversationId,
        count: sql<number>`count(${messages.id})::int`,
      })
      .from(conversationParticipants)
      .leftJoin(
        messages,
        and(
          eq(messages.conversationId, conversationParticipants.conversationId),
          sql`${messages.senderId} != ${userId}`,
          sql`(${conversationParticipants.lastReadAt} is null or ${messages.createdAt} > ${conversationParticipants.lastReadAt})`,
        ),
      )
      .where(eq(conversationParticipants.userId, userId))
      .groupBy(conversationParticipants.conversationId);

    const result: Record<string, number> = {};
    for (const r of rows) result[r.conversationId] = Number(r.count);
    return result;
  }
}
