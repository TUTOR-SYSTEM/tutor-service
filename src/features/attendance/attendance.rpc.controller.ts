import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type { UpsertAttendanceDto } from '@packages/entities/attendance';
import { AttendanceService } from './attendance.service';

/**
 * Message-pattern mirror of `AttendanceController` — reached only by the gateway's `TUTOR_SERVICE`
 * `ClientProxy` over RabbitMQ. Delegates to the same, unmodified
 * `AttendanceService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class AttendanceRpcController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @MessagePattern('attendance.getBySession')
  getBySession(@Payload() payload: { userId: string; sessionId: string }) {
    return this.attendanceService.getBySessionService(payload);
  }

  @MessagePattern('attendance.upsert')
  upsert(@Payload() payload: { userId: string; data: UpsertAttendanceDto }) {
    return this.attendanceService.upsertAttendanceService(payload);
  }
}