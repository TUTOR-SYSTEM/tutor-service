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
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { resolveJwtAccessSecret } from '../../packages/configs/jwt-sign.config';
import { MessageService } from './message.service';
import { ConversationService } from './conversation.service';
import { RmqProducer } from '../rabbitmq/rmq.producer';
import { resolveCorsOrigins } from '@packages/helpers/cors.helper';
import {
  messageContentSchema,
  MESSAGE_RATE_LIMIT_MAX,
  MESSAGE_RATE_WINDOW_MS,
} from './chat.schema';

type AuthenticatedSocket = Socket & {
  userId?: string;
  userRole?: string;
  userEmail?: string;
};

@WebSocketGateway({
  cors: {
    origin: resolveCorsOrigins(),
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  private readonly sessionTimers = new Map<string, ReturnType<typeof setTimeout>>(); // socketId -> expiry timer
  private readonly onlineUsers = new Map<string, Set<string>>(); // userId -> socketIds (one user, many tabs)
  private readonly messageWindows = new Map<string, { count: number; windowStart: number }>(); // socketId -> message:send window

  // fixed-window limit per socket for message:send
  private allowMessageSend(socketId: string, now = Date.now()): boolean {
    const window = this.messageWindows.get(socketId);
    if (!window || now - window.windowStart >= MESSAGE_RATE_WINDOW_MS) {
      this.messageWindows.set(socketId, { count: 1, windowStart: now });
      return true;
    }
    if (window.count >= MESSAGE_RATE_LIMIT_MAX) return false;
    window.count += 1;
    return true;
  }

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly messageService: MessageService,
    private readonly conversationService: ConversationService,
    private readonly rmqProducer: RmqProducer,
  ) {}

  // same rules as JwtAuthGuard: access token carries a session id that must still be live in redis
  private async isSessionLive(userId: string, sid: unknown): Promise<boolean> {
    if (typeof sid !== 'string' || !sid) return false;
    try {
      const live = await this.rmqProducer.send<boolean, { key: string }>(
        'redis.exists',
        { key: `session:${userId}:${sid}` },
        2000,
        1,
      );
      return live === true;
    } catch (error) {
      // fail closed unless explicitly opted out, matching JwtAuthGuard
      if (process.env.SESSION_CHECK_FAIL_OPEN === 'true') return true;
      this.logger.warn(`WS session check unavailable: ${String(error)}`);
      return false;
    }
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      const accessSecret = resolveJwtAccessSecret(this.configService);

      const decoded = this.jwtService.verify(token, { secret: accessSecret });

      if (!decoded || decoded.typ !== 'access') {
        client.disconnect();
        return;
      }

      const userId = decoded.sub;

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, isActive: true },
      });
      if (!user || user.isActive === false) {
        client.disconnect();
        return;
      }

      if (!(await this.isSessionLive(userId, decoded.sid))) {
        client.disconnect();
        return;
      }

      // drop the socket when the access token expires so a long-lived connection can't outlive it
      if (typeof decoded.exp === 'number') {
        const ms = Math.max(decoded.exp * 1000 - Date.now(), 0);
        this.sessionTimers.set(
          client.id,
          setTimeout(() => client.disconnect(), Math.min(ms, 2_147_483_647)),
        );
      }

      client.userId = userId;
      client.userRole = decoded.role;
      client.userEmail = decoded.email;

      const sockets = this.onlineUsers.get(userId) ?? new Set<string>();
      const wasOffline = sockets.size === 0;
      sockets.add(client.id);
      this.onlineUsers.set(userId, sockets);

      if (wasOffline) {
        this.server.emit('user:status', { userId, status: 'online' });
      }

      console.log(`[WS] User connected: ${userId} (${client.id})`);
    } catch (error) {
      console.error('[WS] Connection error:', error);
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    const timer = this.sessionTimers.get(client.id);
    if (timer) {
      clearTimeout(timer);
      this.sessionTimers.delete(client.id);
    }
    this.messageWindows.delete(client.id);
    if (client.userId) {
      const sockets = this.onlineUsers.get(client.userId);
      if (!sockets?.delete(client.id)) return; // this socket was never registered as online
      // offline only once the user's last socket is gone
      if (sockets.size === 0) {
        this.onlineUsers.delete(client.userId);
        this.server.emit('user:status', { userId: client.userId, status: 'offline' });
      }
      console.log(`[WS] User disconnected: ${client.userId} (${client.id})`);
    }
  }

  @SubscribeMessage('message:send')
  async handleMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; content: string },
  ) {
    if (!client.userId) return;

    if (!this.allowMessageSend(client.id)) {
      return { event: 'message:error', data: { error: 'Too many messages, slow down' } };
    }
    if (!messageContentSchema.safeParse(data?.content).success) {
      return { event: 'message:error', data: { error: 'Invalid message content' } };
    }

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
  async handleJoinConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    // Only participants may subscribe to a room, otherwise anyone who learns a conversation id
    // would receive its `message:receive` broadcasts.
    if (!client.userId || !(await this.isParticipant(data?.conversationId, client.userId))) {
      return { event: 'conversation:error', data: { error: 'Not a participant' } };
    }
    void client.join(data.conversationId);
    return { event: 'conversation:joined', data: { conversationId: data.conversationId } };
  }

  private async isParticipant(conversationId: string, userId: string): Promise<boolean> {
    if (typeof conversationId !== 'string' || !conversationId) return false;
    try {
      const row = await this.prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
        select: { id: true },
      });
      return !!row;
    } catch {
      return false;
    }
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
    // Only sockets that joined (i.e. passed the participant check) may emit into the room.
    if (!client.userId || !client.rooms.has(data?.conversationId)) return;
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
    if (!client.userId || !client.rooms.has(data?.conversationId)) return;
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
    if (!client.userId || !(await this.isParticipant(data?.conversationId, client.userId))) return;

    try {
      // the message must belong to this conversation; otherwise nothing is updated or broadcast
      const updated = await this.messageService.updateMessageStatus(
        data.messageId,
        'READ',
        data.conversationId,
      );
      await this.messageService.markConversationAsRead(data.conversationId, client.userId);

      if (updated) {
        this.server.to(data.conversationId).emit('message:read', {
          userId: client.userId,
          conversationId: data.conversationId,
          messageId: data.messageId,
        });
      }
    } catch (error) {
      console.error('[WS] Error marking message as read:', error);
    }
  }

  // Utility: send to specific user
  sendToUser(userId: string, event: string, data: unknown) {
    for (const socketId of this.onlineUsers.get(userId) ?? []) {
      this.server.to(socketId).emit(event, data);
    }
  }

  // Utility: broadcast to conversation
  broadcastToConversation(conversationId: string, event: string, data: unknown) {
    this.server.to(conversationId).emit(event, data);
  }

  // Utility: check if user is online
  isUserOnline(userId: string): boolean {
    return (this.onlineUsers.get(userId)?.size ?? 0) > 0;
  }
}
