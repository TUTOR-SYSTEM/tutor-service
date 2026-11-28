import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  lessonCreatePayloadSchema,
  lessonDeletePayloadSchema,
  lessonGetAllPayloadSchema,
  lessonIdPayloadSchema,
  lessonUpdatePayloadSchema,
} from '@packages/entities/rpc';
import { parseRpcPayload } from '@packages/pipes';
import { LessonService } from './lesson.service';

/**
 * Message-pattern mirror of `LessonController` — reached only by the gateway's `TUTOR_SERVICE`
 * `ClientProxy` over RabbitMQ. Validates the payload (`rpc-payload.schema.ts`) and delegates to
 * the same, unmodified `LessonService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class LessonRpcController {
  constructor(private readonly lessonService: LessonService) {}

  @MessagePattern('lesson.create')
  create(@Payload() payload: unknown) {
    return this.lessonService.createLessonService(
      parseRpcPayload(lessonCreatePayloadSchema, payload),
    );
  }

  @MessagePattern('lesson.getAll')
  getAll(@Payload() payload: unknown) {
    return this.lessonService.getAllLessonsService(
      parseRpcPayload(lessonGetAllPayloadSchema, payload),
    );
  }

  @MessagePattern('lesson.getById')
  getById(@Payload() payload: unknown) {
    return this.lessonService.getLessonByIdService(parseRpcPayload(lessonIdPayloadSchema, payload));
  }

  @MessagePattern('lesson.update')
  update(@Payload() payload: unknown) {
    return this.lessonService.updateLessonService(
      parseRpcPayload(lessonUpdatePayloadSchema, payload),
    );
  }

  @MessagePattern('lesson.delete')
  del(@Payload() payload: unknown) {
    return this.lessonService.deleteLessonService(
      parseRpcPayload(lessonDeletePayloadSchema, payload),
    );
  }
}
