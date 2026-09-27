import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type {
  CreateTuitionDto,
  GetTuitionsQueryDto,
  UpdateTuitionDto,
} from '@packages/entities/tuition';
import { TuitionService } from './tuition.service';

/**
 * Message-pattern mirror of `TuitionController` — reached only by the gateway's `TUTOR_SERVICE`
 * `ClientProxy` over RabbitMQ. Delegates to the same, unmodified
 * `TuitionService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class TuitionRpcController {
  constructor(private readonly tuitionService: TuitionService) {}

  @MessagePattern('tuition.create')
  create(@Payload() payload: { data: CreateTuitionDto; userId: string }) {
    return this.tuitionService.create(payload.data, payload.userId);
  }

  @MessagePattern('tuition.getAll')
  getAll(@Payload() query: GetTuitionsQueryDto) {
    return this.tuitionService.findAll(query);
  }

  @MessagePattern('tuition.getSummary')
  getSummary(@Payload() classId?: string) {
    return this.tuitionService.getSummary(classId);
  }

  @MessagePattern('tuition.getById')
  getById(@Payload() id: string) {
    return this.tuitionService.findById(id);
  }

  @MessagePattern('tuition.update')
  update(@Payload() payload: { id: string; data: UpdateTuitionDto; userId: string }) {
    return this.tuitionService.update(payload.id, payload.data, payload.userId);
  }

  @MessagePattern('tuition.delete')
  del(@Payload() payload: { id: string; userId: string }) {
    return this.tuitionService.delete(payload.id, payload.userId);
  }
}