import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ChatGateway } from 'src/features/chat/chat.gateway';
import {
  MESSAGE_CONTENT_MAX_LENGTH,
  MESSAGE_RATE_LIMIT_MAX,
  MESSAGE_RATE_WINDOW_MS,
} from 'src/features/chat/chat.schema';
import { createPrismaMock, PrismaMock } from '../../support/prisma.mock';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const CONV_ID = '44444444-4444-4444-8444-444444444444';
const MSG_ID = '66666666-6666-4666-8666-666666666666';

type FakeSocket = {
  id: string;
  userId?: string;
  userRole?: string;
  handshake: { auth: { token: string }; headers: Record<string, string> };
  disconnect: jest.Mock;
  join: jest.Mock;
  leave: jest.Mock;
  rooms: Set<string>;
};

const makeSocket = (id: string): FakeSocket => ({
  id,
  handshake: { auth: { token: `token-${id}` }, headers: {} },
  disconnect: jest.fn(),
  join: jest.fn(),
  leave: jest.fn(),
  rooms: new Set(),
});

describe('ChatGateway', () => {
  let prisma: PrismaMock;
  let emit: jest.Mock;
  let server: { emit: jest.Mock; to: jest.Mock };
  let messageService: {
    createMessage: jest.Mock;
    updateMessageStatus: jest.Mock;
    markConversationAsRead: jest.Mock;
  };
  let rmq: { send: jest.Mock };
  let gateway: ChatGateway;

  // token-<socketId>: the socket id prefix names the user so tests can use one socket per tab
  const userFor = (socketId: string) => (socketId.startsWith('u2') ? OTHER_ID : USER_ID);

  const connect = async (socket: FakeSocket) => {
    const userId = userFor(socket.id);
    // handleConnection reads the subject from the token; tie each fake socket to its user
    socket.handshake.auth.token = `token-${userId}-${socket.id}`;
    await gateway.handleConnection(socket as never);
    return socket;
  };

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    prisma = createPrismaMock();
    prisma.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, isActive: true }),
    );
    prisma.conversationParticipant.findUnique.mockResolvedValue({ id: 'p' });

    const jwt = {
      verify: jest.fn((token: string) => ({
        sub: token.startsWith(`token-${OTHER_ID}`) ? OTHER_ID : USER_ID,
        typ: 'access',
        role: 'STUDENT',
        sid: 'sid',
        email: 'e@x.y',
      })),
    };
    const config = { get: jest.fn(() => 'test-secret') };

    emit = jest.fn();
    server = { emit: jest.fn(), to: jest.fn(() => ({ emit })) };
    messageService = {
      createMessage: jest.fn().mockImplementation((conversationId, senderId, content) =>
        Promise.resolve({
          id: MSG_ID,
          conversationId,
          senderId,
          content,
          status: 'SENT',
          createdAt: new Date(0),
        }),
      ),
      updateMessageStatus: jest.fn().mockResolvedValue({ id: MSG_ID }),
      markConversationAsRead: jest.fn().mockResolvedValue(undefined),
    };
    rmq = { send: jest.fn().mockResolvedValue(true) };

    gateway = new ChatGateway(
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      prisma as never,
      messageService as never,
      {} as never,
      rmq as never,
    );
    gateway.server = server as never;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('presence with several sockets per user (TS-14)', () => {
    it('stays online until the last socket of the user disconnects', async () => {
      const tab1 = await connect(makeSocket('u1-a'));
      const tab2 = await connect(makeSocket('u1-b'));

      expect(gateway.isUserOnline(USER_ID)).toBe(true);
      // only the first socket flips the user online
      const onlineEvents = server.emit.mock.calls.filter(
        ([name, body]) => name === 'user:status' && body.status === 'online',
      );
      expect(onlineEvents).toHaveLength(1);

      gateway.handleDisconnect(tab1 as never);
      expect(gateway.isUserOnline(USER_ID)).toBe(true);
      expect(server.emit).not.toHaveBeenCalledWith('user:status', {
        userId: USER_ID,
        status: 'offline',
      });

      gateway.handleDisconnect(tab2 as never);
      expect(gateway.isUserOnline(USER_ID)).toBe(false);
      expect(server.emit).toHaveBeenCalledWith('user:status', {
        userId: USER_ID,
        status: 'offline',
      });
    });

    it('keeps other users independent', async () => {
      const mine = await connect(makeSocket('u1-a'));
      await connect(makeSocket('u2-a'));

      gateway.handleDisconnect(mine as never);

      expect(gateway.isUserOnline(USER_ID)).toBe(false);
      expect(gateway.isUserOnline(OTHER_ID)).toBe(true);
    });

    it('sendToUser reaches every socket of the user', async () => {
      await connect(makeSocket('u1-a'));
      await connect(makeSocket('u1-b'));

      gateway.sendToUser(USER_ID, 'notice', { hi: true });

      expect(server.to).toHaveBeenCalledWith('u1-a');
      expect(server.to).toHaveBeenCalledWith('u1-b');
      expect(emit).toHaveBeenCalledWith('notice', { hi: true });
    });
  });

  describe('message:send limits (TS-22)', () => {
    it(`rejects content over ${MESSAGE_CONTENT_MAX_LENGTH} characters without writing`, async () => {
      const socket = await connect(makeSocket('u1-a'));

      const result = await gateway.handleMessage(socket as never, {
        conversationId: CONV_ID,
        content: 'a'.repeat(MESSAGE_CONTENT_MAX_LENGTH + 1),
      });

      expect(result).toEqual({
        event: 'message:error',
        data: { error: 'Invalid message content' },
      });
      expect(messageService.createMessage).not.toHaveBeenCalled();
    });

    it('rejects empty content', async () => {
      const socket = await connect(makeSocket('u1-a'));

      const result = await gateway.handleMessage(socket as never, {
        conversationId: CONV_ID,
        content: '',
      });

      expect(result).toMatchObject({ event: 'message:error' });
      expect(messageService.createMessage).not.toHaveBeenCalled();
    });

    it('accepts content of exactly the limit', async () => {
      const socket = await connect(makeSocket('u1-a'));

      const result = await gateway.handleMessage(socket as never, {
        conversationId: CONV_ID,
        content: 'a'.repeat(MESSAGE_CONTENT_MAX_LENGTH),
      });

      expect(result).toMatchObject({ event: 'message:sent' });
      expect(messageService.createMessage).toHaveBeenCalledTimes(1);
    });

    it('allows at most MESSAGE_RATE_LIMIT_MAX messages per socket per window', async () => {
      const now = 1_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);
      const socket = await connect(makeSocket('u1-a'));
      const send = () =>
        gateway.handleMessage(socket as never, { conversationId: CONV_ID, content: 'hi' });

      for (let i = 0; i < MESSAGE_RATE_LIMIT_MAX; i++) {
        expect(await send()).toMatchObject({ event: 'message:sent' });
      }
      expect(await send()).toEqual({
        event: 'message:error',
        data: { error: 'Too many messages, slow down' },
      });
      expect(messageService.createMessage).toHaveBeenCalledTimes(MESSAGE_RATE_LIMIT_MAX);

      // the rate limit is per socket: a second socket of another user is unaffected
      const other = await connect(makeSocket('u2-a'));
      expect(
        await gateway.handleMessage(other as never, { conversationId: CONV_ID, content: 'hi' }),
      ).toMatchObject({ event: 'message:sent' });

      // and it resets once the window has passed
      jest.spyOn(Date, 'now').mockReturnValue(now + MESSAGE_RATE_WINDOW_MS);
      expect(await send()).toMatchObject({ event: 'message:sent' });
    });
  });

  describe('message:read scope (TS-11)', () => {
    it('updates the message only within the conversation it was sent to', async () => {
      const socket = await connect(makeSocket('u1-a'));

      await gateway.handleMessageRead(socket as never, {
        conversationId: CONV_ID,
        messageId: MSG_ID,
      });

      expect(messageService.updateMessageStatus).toHaveBeenCalledWith(MSG_ID, 'READ', CONV_ID);
    });

    it('does not broadcast a read receipt when the message is not in the conversation', async () => {
      messageService.updateMessageStatus.mockResolvedValue(undefined);
      const socket = await connect(makeSocket('u1-a'));

      await gateway.handleMessageRead(socket as never, {
        conversationId: CONV_ID,
        messageId: MSG_ID,
      });

      expect(server.to).not.toHaveBeenCalledWith(CONV_ID);
    });
  });
});
