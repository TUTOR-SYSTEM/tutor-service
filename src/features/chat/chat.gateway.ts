/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { DRIZZLE } from '../../database/database.module';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { users } from 'src/database/schema';
import { MessageService } from './message.service';
import { ConversationService } from './conversation.service';

type AuthenticatedSocket = Socket & {
  userId?: string;
  userRole?: string;
  userEmail?: string;
};

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly onlineUsers = new Map<string, string>(); // userId -> socketId

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<Record<string, never>>,
    private readonly messageService: MessageService,
    private readonly conversationService: ConversationService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      const accessSecret =
        this.configService.get<string>('JWT_ACCESS_SECRET') ??
        this.configService.get<string>('JWT_SECRET') ??
        'dev-insecure-jwt-secret';

      const decoded = this.jwtService.verify(token, { secret: accessSecret });

      if (!decoded || decoded.typ !== 'access') {
        client.disconnect();
        return;
      }

      const userId = decoded.sub;

      const user = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (user.length === 0) {
        client.disconnect();
        return;
      }

      client.userId = userId;
      client.userRole = decoded.role;
      client.userEmail = decoded.email;

      this.onlineUsers.set(userId, client.id);

      this.server.emit('user:status', { userId, status: 'online' });

      console.log(`[WS] User connected: ${userId} (${client.id})`);
    } catch (error) {
      console.error('[WS] Connection error:', error);
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    if (client.userId) {
      this.onlineUsers.delete(client.userId);
      this.server.emit('user:status', { userId: client.userId, status: 'offline' });
      console.log(`[WS] User disconnected: ${client.userId} (${client.id})`);
    }
  }

  @SubscribeMessage('message:send')
  async handleMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; content: string },
  ) {
    if (!client.userId) return;

    try {
      const message = await this.messageService.createMessage(
        data.conversationId,
        client.userId,
        data.content,
      );

      const messagePayload = {
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        senderRole: client.userRole,
        content: message.content,
        timestamp: message.createdAt,
        status: message.status,
      };

      this.server.to(data.conversationId).emit('message:receive', messagePayload);

      return { event: 'message:sent', data: { messageId: message.id, status: 'delivered' } };
    } catch (error) {
      console.error('[WS] Error sending message:', error);
      return { event: 'message:error', data: { error: 'Failed to send message' } };
    }
  }

  @SubscribeMessage('conversation:join')
  handleJoinConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    void client.join(data.conversationId);
    return { event: 'conversation:joined', data: { conversationId: data.conversationId } };
  }

  @SubscribeMessage('conversation:leave')
  handleLeaveConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    void client.leave(data.conversationId);
    return { event: 'conversation:left', data: { conversationId: data.conversationId } };
  }

  @SubscribeMessage('typing:start')
  handleTypingStart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!client.userId) return;
    client.to(data.conversationId).emit('typing:start', {
      userId: client.userId,
      conversationId: data.conversationId,
    });
  }

  @SubscribeMessage('typing:stop')
  handleTypingStop(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!client.userId) return;
    client.to(data.conversationId).emit('typing:stop', {
      userId: client.userId,
      conversationId: data.conversationId,
    });
  }

  @SubscribeMessage('user:get-online')
  handleGetOnlineUsers() {
    const onlineUserIds = Array.from(this.onlineUsers.keys());
    return { event: 'user:list-online', data: onlineUserIds };
  }

  @SubscribeMessage('message:read')
  async handleMessageRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; messageId: string },
  ) {
    if (!client.userId) return;

    try {
      await this.messageService.updateMessageStatus(data.messageId, 'READ');
      await this.messageService.markConversationAsRead(data.conversationId, client.userId);

      this.server.to(data.conversationId).emit('message:read', {
        userId: client.userId,
        conversationId: data.conversationId,
        messageId: data.messageId,
      });
    } catch (error) {
      console.error('[WS] Error marking message as read:', error);
    }
  }

  // Utility: send to specific user
  sendToUser(userId: string, event: string, data: unknown) {
    const socketId = this.onlineUsers.get(userId);
    if (socketId) {
      this.server.to(socketId).emit(event, data);
    }
  }

  // Utility: broadcast to conversation
  broadcastToConversation(conversationId: string, event: string, data: unknown) {
    this.server.to(conversationId).emit(event, data);
  }

  // Utility: check if user is online
  isUserOnline(userId: string): boolean {
    return this.onlineUsers.has(userId);
  }
}
