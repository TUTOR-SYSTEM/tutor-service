import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService, isRecordNotFound } from '../../database/prisma.service';

@Injectable()
export class MessageService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertParticipant(conversationId: string, userId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { id: true },
    });

    if (!participant) {
      throw new ForbiddenException('You are not a participant of this conversation');
    }
  }

  async getMessages(conversationId: string, userId: string, limit = 50, before?: string) {
    await this.assertParticipant(conversationId, userId);

    const beforeMsg = before
      ? await this.prisma.message.findUnique({
          where: { id: before },
          select: { createdAt: true },
        })
      : null;

    const result = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(beforeMsg && { createdAt: { lt: beforeMsg.createdAt } }),
      },
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        content: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return result.reverse();
  }

  async createMessage(conversationId: string, senderId: string, content: string) {
    await this.assertParticipant(conversationId, senderId);

    const newMessage = await this.prisma.message.create({
      data: { conversationId, senderId, content, status: 'SENT' },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    return newMessage;
  }

  async updateMessageStatus(messageId: string, status: 'DELIVERED' | 'READ') {
    try {
      return await this.prisma.message.update({ where: { id: messageId }, data: { status } });
    } catch (error) {
      if (isRecordNotFound(error)) return undefined;
      throw error;
    }
  }

  async markConversationAsRead(conversationId: string, userId: string) {
    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId, userId },
      data: { lastReadAt: new Date() },
    });

    await this.prisma.message.updateMany({
      where: { conversationId, senderId: { not: userId }, status: { not: 'READ' } },
      data: { status: 'READ' },
    });
  }

  async getUnreadCounts(userId: string) {
    // one grouped query across all of the user's conversations (was 1+N)
    const rows = await this.prisma.$queryRaw<{ conversationId: string; count: number }[]>`
      SELECT cp.conversation_id AS "conversationId", count(m.id)::int AS count
      FROM conversation_participants cp
      LEFT JOIN messages m
        ON m.conversation_id = cp.conversation_id
       AND m.sender_id != ${userId}::uuid
       AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
      WHERE cp.user_id = ${userId}::uuid
      GROUP BY cp.conversation_id`;

    const result: Record<string, number> = {};
    for (const r of rows) result[r.conversationId] = Number(r.count);
    return result;
  }
}
