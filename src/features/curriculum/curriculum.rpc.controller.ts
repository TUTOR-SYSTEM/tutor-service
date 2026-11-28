import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  curriculumCreatePayloadSchema,
  curriculumGenerateCodePayloadSchema,
  curriculumGetAllPayloadSchema,
  curriculumIdPayloadSchema,
  curriculumUpdatePayloadSchema,
} from '@packages/entities/rpc';
import { parseRpcPayload } from '@packages/pipes';
import { CurriculumService } from './curriculum.service';

/**
 * Message-pattern mirror of `CurriculumController` — reached only by the gateway's `TUTOR_SERVICE`
 * `ClientProxy` over RabbitMQ. Validates the payload (`rpc-payload.schema.ts`) and delegates to
 * the same, unmodified `CurriculumService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class CurriculumRpcController {
  constructor(private readonly curriculumService: CurriculumService) {}

  @MessagePattern('curriculum.generateCode')
  // replies with the bare code string (CONTRACT C4) — the UI reads it as a string
  generateCode(@Payload() payload?: unknown) {
    const parsed = parseRpcPayload(curriculumGenerateCodePayloadSchema, payload);
    return this.curriculumService.generateNewCodeService(parsed?.subject);
  }

  @MessagePattern('curriculum.create')
  create(@Payload() payload: unknown) {
    return this.curriculumService.createCurriculumService(
      parseRpcPayload(curriculumCreatePayloadSchema, payload),
    );
  }

  @MessagePattern('curriculum.getAll')
  getAll(@Payload() payload: unknown) {
    return this.curriculumService.getAllCurriculumService(
      parseRpcPayload(curriculumGetAllPayloadSchema, payload),
    );
  }

  @MessagePattern('curriculum.getById')
  getById(@Payload() payload: unknown) {
    return this.curriculumService.getCurriculumByIdService(
      parseRpcPayload(curriculumIdPayloadSchema, payload),
    );
  }

  @MessagePattern('curriculum.update')
  update(@Payload() payload: unknown) {
    return this.curriculumService.updateCurriculumService(
      parseRpcPayload(curriculumUpdatePayloadSchema, payload),
    );
  }

  @MessagePattern('curriculum.delete')
  del(@Payload() payload: unknown) {
    return this.curriculumService.deleteCurriculumService(
      parseRpcPayload(curriculumIdPayloadSchema, payload),
    );
  }
}
