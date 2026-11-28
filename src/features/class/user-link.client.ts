import { Injectable } from '@nestjs/common';
import { RmqProducer } from '../rabbitmq/rmq.producer';
import { signUserActorMessage } from '@packages/helpers/user-actor.helper';

export type LinkActor = { id: string; role?: string | null };

/**
 * tutor-service → user-service link calls (report TS-23). The tutor/parent link on `users` is owned
 * by user-service: these RPCs make it write the link, authorized against the class row. Sent as the
 * acting user, signed like the gateway does. One attempt only: a retried send would be a replay.
 */
@Injectable()
export class UserLinkClient {
  constructor(private readonly rmq: RmqProducer) {}

  linkStudentsToTutor(actor: LinkActor, payload: { classId: string; studentIds: string[] }) {
    return this.send('user.linkStudentsToTutor', actor, payload);
  }

  releaseStudentParent(actor: LinkActor, payload: { classId: string; studentId: string }) {
    return this.send('user.releaseStudentParent', actor, payload);
  }

  private send<TResponse>(pattern: string, actor: LinkActor, payload: object) {
    const secret = process.env.RPC_ACTOR_SECRET?.trim();
    if (!secret) throw new Error('RPC_ACTOR_SECRET must be set to act for a user in user-service');
    const message = signUserActorMessage(
      payload,
      pattern,
      { id: actor.id, role: actor.role ?? '' },
      secret,
    );
    return this.rmq.send<TResponse, typeof message>(pattern, message, 5000, 0);
  }
}
