import { Module } from '@nestjs/common';
import { CourseProgressRpcController } from './course-progress.rpc.controller';
import { CourseProgressRepository } from './course-progress.repository';
import { CourseProgressService } from './course-progress.service';

@Module({
  controllers: [CourseProgressRpcController],
  providers: [CourseProgressService, CourseProgressRepository],
})
export class CourseProgressModule {}
