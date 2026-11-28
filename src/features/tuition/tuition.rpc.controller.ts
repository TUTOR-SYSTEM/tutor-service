import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  tuitionCreatePayloadSchema,
  tuitionGetAllPayloadSchema,
  tuitionGetSummaryPayloadSchema,
  tuitionIdPayloadSchema,
  tuitionUpdatePayloadSchema,
} from '@packages/entities/rpc';
import { parseRpcPayload } from '@packages/pipes';
import { TuitionService } from './tuition.service';

/**
 * Message-pattern mirror of `TuitionController` — reached only by the gateway's `TUTOR_SERVICE`
 * `ClientProxy` over RabbitMQ. Validates the payload (`rpc-payload.schema.ts`) and delegates to
 * the same, unmodified `TuitionService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class TuitionRpcController {
  constructor(private readonly tuitionService: TuitionService) {}

  @MessagePattern('tuition.create')
  create(@Payload() payload: unknown) {
    const parsed = parseRpcPayload(tuitionCreatePayloadSchema, payload);
    return this.tuitionService.create(parsed.data, parsed.userId, parsed.role);
  }

  @MessagePattern('tuition.getAll')
  getAll(@Payload() payload: unknown) {
    return this.tuitionService.findAll(parseRpcPayload(tuitionGetAllPayloadSchema, payload));
  }

  @MessagePattern('tuition.getSummary')
  getSummary(@Payload() payload: unknown) {
    return this.tuitionService.getSummary(parseRpcPayload(tuitionGetSummaryPayloadSchema, payload));
  }

  @MessagePattern('tuition.getById')
  getById(@Payload() payload: unknown) {
    return this.tuitionService.findById(parseRpcPayload(tuitionIdPayloadSchema, payload));
  }

  @MessagePattern('tuition.update')
  update(@Payload() payload: unknown) {
    const parsed = parseRpcPayload(tuitionUpdatePayloadSchema, payload);
    return this.tuitionService.update(parsed.id, parsed.data, parsed.userId, parsed.role);
  }

  @MessagePattern('tuition.delete')
  del(@Payload() payload: unknown) {
    const parsed = parseRpcPayload(tuitionIdPayloadSchema, payload);
    return this.tuitionService.delete(parsed.id, parsed.userId, parsed.role);
  }
}
