import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  attendanceGetBySessionPayloadSchema,
  attendanceUpsertPayloadSchema,
} from '@packages/entities/rpc';
import { parseRpcPayload } from '@packages/pipes';
import { AttendanceService } from './attendance.service';

/**
 * Message-pattern mirror of `AttendanceController` — reached only by the gateway's `TUTOR_SERVICE`
 * `ClientProxy` over RabbitMQ. Validates the payload (`rpc-payload.schema.ts`) and delegates to
 * the same, unmodified `AttendanceService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class AttendanceRpcController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @MessagePattern('attendance.getBySession')
  getBySession(@Payload() payload: unknown) {
    return this.attendanceService.getBySessionService(
      parseRpcPayload(attendanceGetBySessionPayloadSchema, payload),
    );
  }

  @MessagePattern('attendance.upsert')
  upsert(@Payload() payload: unknown) {
    return this.attendanceService.upsertAttendanceService(
      parseRpcPayload(attendanceUpsertPayloadSchema, payload),
    );
  }
}
