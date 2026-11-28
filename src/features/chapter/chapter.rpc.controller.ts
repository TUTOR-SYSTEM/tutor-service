import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  chapterCreatePayloadSchema,
  chapterDeletePayloadSchema,
  chapterGetAllPayloadSchema,
  chapterIdPayloadSchema,
  chapterUpdatePayloadSchema,
} from '@packages/entities/rpc';
import { parseRpcPayload } from '@packages/pipes';
import { ChapterService } from './chapter.service';

/**
 * Message-pattern mirror of `ChapterController` — reached only by the gateway's `TUTOR_SERVICE`
 * `ClientProxy` over RabbitMQ. Validates the payload (`rpc-payload.schema.ts`) and delegates to
 * the same, unmodified `ChapterService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class ChapterRpcController {
  constructor(private readonly chapterService: ChapterService) {}

  @MessagePattern('chapter.create')
  create(@Payload() payload: unknown) {
    return this.chapterService.createChapterService(
      parseRpcPayload(chapterCreatePayloadSchema, payload),
    );
  }

  @MessagePattern('chapter.getAll')
  getAll(@Payload() payload: unknown) {
    return this.chapterService.getAllChaptersService(
      parseRpcPayload(chapterGetAllPayloadSchema, payload),
    );
  }

  @MessagePattern('chapter.getById')
  getById(@Payload() payload: unknown) {
    return this.chapterService.getChapterByIdService(
      parseRpcPayload(chapterIdPayloadSchema, payload),
    );
  }

  @MessagePattern('chapter.update')
  update(@Payload() payload: unknown) {
    return this.chapterService.updateChapterService(
      parseRpcPayload(chapterUpdatePayloadSchema, payload),
    );
  }

  @MessagePattern('chapter.delete')
  del(@Payload() payload: unknown) {
    return this.chapterService.deleteChapterService(
      parseRpcPayload(chapterDeletePayloadSchema, payload),
    );
  }
}
