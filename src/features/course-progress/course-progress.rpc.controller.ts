import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type { CourseProgressSnapshot } from '@packages/entities/course-progress';
import { CourseProgressService } from './course-progress.service';

/** Message-pattern cho gateway (RMQ). Không có logic ở đây, chỉ gọi service. */
@Controller()
export class CourseProgressRpcController {
  constructor(private readonly service: CourseProgressService) {}

  @MessagePattern('courseProgress.getResults')
  getResults(@Payload() payload: { userId: string }) {
    return this.service.getResults(payload);
  }

  @MessagePattern('courseProgress.sync')
  sync(@Payload() payload: { userId: string; data: CourseProgressSnapshot }) {
    return this.service.sync(payload);
  }
}
