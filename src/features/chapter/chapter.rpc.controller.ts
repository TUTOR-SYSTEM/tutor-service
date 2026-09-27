import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type {
  CreateChapterDto,
  GetChaptersQueryDto,
  UpdateChapterDto,
} from '@packages/entities/curriculum';
import { ChapterService } from './chapter.service';

/**
 * Message-pattern mirror of `ChapterController` — reached only by the gateway's `TUTOR_SERVICE`
 * `ClientProxy` over RabbitMQ. Delegates to the same, unmodified
 * `ChapterService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class ChapterRpcController {
  constructor(private readonly chapterService: ChapterService) {}

  @MessagePattern('chapter.create')
  create(@Payload() payload: { curriculumId: string; data: CreateChapterDto }) {
    return this.chapterService.createChapterService(payload);
  }

  @MessagePattern('chapter.getAll')
  getAll(@Payload() payload: { query: GetChaptersQueryDto }) {
    return this.chapterService.getAllChaptersService(payload);
  }

  @MessagePattern('chapter.getById')
  getById(@Payload() payload: { id: string }) {
    return this.chapterService.getChapterByIdService(payload);
  }

  @MessagePattern('chapter.update')
  update(@Payload() payload: { id: string; data: UpdateChapterDto }) {
    return this.chapterService.updateChapterService(payload);
  }

  @MessagePattern('chapter.delete')
  del(@Payload() payload: { id: string }) {
    return this.chapterService.deleteChapterService(payload);
  }
}