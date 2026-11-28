import { BadRequestException, Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  courseProgressSyncSchema,
  type CourseProgressSnapshot,
} from '@packages/entities/course-progress';
import { ERROR_MESSAGES } from '../../data/constants';
import { CourseProgressService } from './course-progress.service';

/** Message-pattern cho gateway (RMQ). Chỉ validate payload rồi gọi service. */
@Controller()
export class CourseProgressRpcController {
  constructor(private readonly service: CourseProgressService) {}

  @MessagePattern('courseProgress.getResults')
  getResults(@Payload() payload: { userId: string }) {
    return this.service.getResults(payload);
  }

  @MessagePattern('courseProgress.sync')
  sync(@Payload() payload: { userId: string; data: CourseProgressSnapshot }) {
    const parsed = courseProgressSyncSchema.safeParse(payload);
    if (!parsed.success) throw new BadRequestException(ERROR_MESSAGES.COURSE_PROGRESS_INVALID);
    return this.service.sync(parsed.data);
  }
}
