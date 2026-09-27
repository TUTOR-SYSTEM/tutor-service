export const USER_SERVICE = 'USER_SERVICE';
export const TUTOR_SERVICE = 'TUTOR_SERVICE';
export const THIRD_SERVICE = 'THIRD_SERVICE';

export type RmqTarget = typeof USER_SERVICE | typeof TUTOR_SERVICE | typeof THIRD_SERVICE;

export const RABBITMQ_URL = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';

export const RMQ_QUEUES: Record<RmqTarget, string> = {
  [USER_SERVICE]: process.env.USER_QUEUE ?? 'user_queue',
  [TUTOR_SERVICE]: process.env.TUTOR_QUEUE ?? 'tutor_queue',
  [THIRD_SERVICE]: process.env.THIRD_QUEUE ?? 'third_queue',
};

/** Full-pattern overrides, checked before the prefix map. */
export const RMQ_PATTERN_ROUTES: Record<string, RmqTarget> = {};

/** Routes a pattern by its first dot-separated segment to the service queue that handles it. */
export const RMQ_PREFIX_ROUTES: Record<string, RmqTarget> = {
  auth: USER_SERVICE,
  user: USER_SERVICE,

  redis: THIRD_SERVICE,
  email: THIRD_SERVICE,
  notification: THIRD_SERVICE,
  upload: THIRD_SERVICE,
  log: THIRD_SERVICE,
};

export function resolveRmqTarget(pattern: string): RmqTarget {
  const target = RMQ_PATTERN_ROUTES[pattern] ?? RMQ_PREFIX_ROUTES[pattern.split('.')[0]];
  if (!target) {
    throw new Error(`No RabbitMQ route for pattern "${pattern}" — add it to rmq.constants.ts`);
  }
  return target;
}
