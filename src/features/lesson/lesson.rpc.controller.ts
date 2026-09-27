import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type {
  CreateLessonBodyDto,
  GetLessonsQueryDto,
  UpdateLessonDto,
} from '@packages/entities/curriculum';
import { LessonService } from './lesson.service';

/**
 * Message-pattern mirror of `LessonController` — reached only by the gateway's `TUTOR_SERVICE`
 * `ClientProxy` over RabbitMQ. Delegates to the same, unmodified
 * `LessonService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class LessonRpcController {
  constructor(private readonly lessonService: LessonService) {}

  @MessagePattern('lesson.create')
  create(
    @Payload()
    payload: { curriculumId: string; chapterId?: string | null; data: CreateLessonBodyDto },
  ) {
    return this.lessonService.createLessonService(payload);
  }

  @MessagePattern('lesson.getAll')
  getAll(@Payload() payload: { query: GetLessonsQueryDto }) {
    return this.lessonService.getAllLessonsService(payload);
  }

  @MessagePattern('lesson.getById')
  getById(@Payload() payload: { id: string }) {
    return this.lessonService.getLessonByIdService(payload);
  }

  @MessagePattern('lesson.update')
  update(@Payload() payload: { id: string; data: UpdateLessonDto }) {
    return this.lessonService.updateLessonService(payload);
  }

  @MessagePattern('lesson.delete')
  del(@Payload() payload: { id: string }) {
    return this.lessonService.deleteLessonService(payload);
  }
}