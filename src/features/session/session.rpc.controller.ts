import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type {
  CreateSessionDto,
  CreateSessionsDto,
  GetSessionsQueryDto,
  UpdateSessionDto,
} from '@packages/entities/session';
import { SessionService } from './session.service';

/**
 * Message-pattern mirror of `SessionController` — reached only by the gateway's `TUTOR_SERVICE`
 * `ClientProxy` over RabbitMQ. Delegates to the same, unmodified
 * `SessionService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class SessionRpcController {
  constructor(private readonly sessionService: SessionService) {}

  @MessagePattern('session.create')
  create(@Payload() payload: { userId: string; data: CreateSessionDto }) {
    return this.sessionService.createSessionService(payload);
  }

  @MessagePattern('session.createBulk')
  createBulk(@Payload() payload: { userId: string; data: CreateSessionsDto }) {
    return this.sessionService.createSessionsService(payload);
  }

  @MessagePattern('session.getAll')
  getAll(@Payload() payload: { userId: string; query: GetSessionsQueryDto }) {
    return this.sessionService.getSessionsService(payload);
  }

  @MessagePattern('session.getByClass')
  getByClass(@Payload() payload: { userId: string; classId: string }) {
    return this.sessionService.getSessionsByClassService(payload);
  }

  @MessagePattern('session.getById')
  getById(@Payload() payload: { userId: string; id: string }) {
    return this.sessionService.getSessionService(payload);
  }

  @MessagePattern('session.update')
  update(@Payload() payload: { userId: string; id: string; data: UpdateSessionDto }) {
    return this.sessionService.updateSessionService(payload);
  }

  @MessagePattern('session.delete')
  del(@Payload() payload: { userId: string; id: string }) {
    return this.sessionService.delSessionService(payload);
  }
}