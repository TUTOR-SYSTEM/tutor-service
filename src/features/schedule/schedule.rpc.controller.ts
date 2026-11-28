import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  scheduleCreateBulkPayloadSchema,
  scheduleCreatePayloadSchema,
  scheduleGetAllPayloadSchema,
  scheduleGetByClassPayloadSchema,
  scheduleIdPayloadSchema,
  scheduleUpdatePayloadSchema,
} from '@packages/entities/rpc';
import { parseRpcPayload } from '@packages/pipes';
import { ScheduleService } from './schedule.service';

/**
 * Message-pattern mirror of `ScheduleController` — reached only by the gateway's `TUTOR_SERVICE`
 * `ClientProxy` over RabbitMQ. Validates the payload (`rpc-payload.schema.ts`) and delegates to
 * the same, unmodified `ScheduleService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class ScheduleRpcController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @MessagePattern('schedule.create')
  create(@Payload() payload: unknown) {
    return this.scheduleService.createScheduleService(
      parseRpcPayload(scheduleCreatePayloadSchema, payload),
    );
  }

  @MessagePattern('schedule.createBulk')
  createBulk(@Payload() payload: unknown) {
    return this.scheduleService.createSchedulesService(
      parseRpcPayload(scheduleCreateBulkPayloadSchema, payload),
    );
  }

  @MessagePattern('schedule.getAll')
  getAll(@Payload() payload: unknown) {
    return this.scheduleService.getSchedulesService(
      parseRpcPayload(scheduleGetAllPayloadSchema, payload),
    );
  }

  @MessagePattern('schedule.getByClass')
  getByClass(@Payload() payload: unknown) {
    return this.scheduleService.getSchedulesByClassService(
      parseRpcPayload(scheduleGetByClassPayloadSchema, payload),
    );
  }

  @MessagePattern('schedule.getById')
  getById(@Payload() payload: unknown) {
    return this.scheduleService.getScheduleService(
      parseRpcPayload(scheduleIdPayloadSchema, payload),
    );
  }

  @MessagePattern('schedule.update')
  update(@Payload() payload: unknown) {
    return this.scheduleService.updateScheduleService(
      parseRpcPayload(scheduleUpdatePayloadSchema, payload),
    );
  }

  @MessagePattern('schedule.delete')
  del(@Payload() payload: unknown) {
    return this.scheduleService.delScheduleService(
      parseRpcPayload(scheduleIdPayloadSchema, payload),
    );
  }
}
