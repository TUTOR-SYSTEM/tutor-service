import { Test } from '@nestjs/testing';
import { NotificationNotifier } from 'src/features/notification/notification.notifier';
import { RmqProducer } from 'src/features/rabbitmq/rmq.producer';

const SENDER = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';

describe('NotificationNotifier', () => {
  let notifier: NotificationNotifier;
  let rmq: { send: jest.Mock };

  beforeEach(async () => {
    rmq = { send: jest.fn().mockResolvedValue({}) };
    const module = await Test.createTestingModule({
      providers: [NotificationNotifier, { provide: RmqProducer, useValue: rmq }],
    }).compile();
    notifier = module.get(NotificationNotifier);
  });

  const base = {
    role: 'TUTOR',
    senderId: SENDER,
    type: 'STUDENT' as const,
    title: 't',
    content: 'c',
  };

  it('sends one message per unique valid recipient without classId', async () => {
    await notifier.notifyUsers({ ...base, recipients: [A, B, A, '', null, undefined, 'nope'] });

    expect(rmq.send).toHaveBeenCalledTimes(2);
    expect(rmq.send).toHaveBeenCalledWith(
      'notification.create',
      expect.objectContaining({
        role: 'TUTOR',
        type: 'STUDENT',
        senderId: SENDER,
        userId: A,
        studentId: A,
      }),
      5000,
      0,
    );
    for (const [, payload] of rmq.send.mock.calls) expect(payload).not.toHaveProperty('classId');
  });

  it('truncates subContent to 255 chars and defaults the role', async () => {
    await notifier.notifyUsers({
      ...base,
      role: null,
      recipients: [A],
      subContent: 'x'.repeat(300),
    });

    const payload = rmq.send.mock.calls[0][1];
    expect(payload.subContent).toHaveLength(255);
    expect(payload.role).toBe('TUTOR');
  });

  it('sends nothing when there are no valid recipients', async () => {
    await notifier.notifyUsers({ ...base, recipients: ['', undefined] });
    expect(rmq.send).not.toHaveBeenCalled();
  });

  it('swallows send failures', async () => {
    rmq.send.mockRejectedValue(new Error('down'));
    await expect(notifier.notifyUsers({ ...base, recipients: [A, B] })).resolves.toBeUndefined();
  });
});
