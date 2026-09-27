import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type {
  CreateScheduleDto,
  CreateSchedulesDto,
  GetSchedulesQueryDto,
  UpdateScheduleDto,
} from '@packages/entities/schedule';
import { ScheduleService } from './schedule.service';

/**
 * Message-pattern mirror of `ScheduleController` — reached only by the gateway's `TUTOR_SERVICE`
 * `ClientProxy` over RabbitMQ. Delegates to the same, unmodified
 * `ScheduleService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class ScheduleRpcController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @MessagePattern('schedule.create')
  create(@Payload() payload: { userId: string; data: CreateScheduleDto }) {
    return this.scheduleService.createScheduleService(payload);
  }

  @MessagePattern('schedule.createBulk')
  createBulk(@Payload() payload: { userId: string; data: CreateSchedulesDto }) {
    return this.scheduleService.createSchedulesService(payload);
  }

  @MessagePattern('schedule.getAll')
  getAll(@Payload() payload: { userId: string; query: GetSchedulesQueryDto }) {
    return this.scheduleService.getSchedulesService(payload);
  }

  @MessagePattern('schedule.getByClass')
  getByClass(@Payload() payload: { userId: string; classId: string }) {
    return this.scheduleService.getSchedulesByClassService(payload);
  }

  @MessagePattern('schedule.getById')
  getById(@Payload() payload: { userId: string; id: string }) {
    return this.scheduleService.getScheduleService(payload);
  }

  @MessagePattern('schedule.update')
  update(@Payload() payload: { userId: string; id: string; data: UpdateScheduleDto }) {
    return this.scheduleService.updateScheduleService(payload);
  }

  @MessagePattern('schedule.delete')
  del(@Payload() payload: { userId: string; id: string }) {
    return this.scheduleService.delScheduleService(payload);
  }
}