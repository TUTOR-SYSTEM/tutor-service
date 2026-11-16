import { Injectable } from '@nestjs/common';
import type { CourseProgressSnapshot, CourseResultsDto } from '@packages/entities/course-progress';
import { CourseProgressRepository } from './course-progress.repository';

@Injectable()
export class CourseProgressService {
  constructor(private readonly repository: CourseProgressRepository) {}

  async sync({ userId, data }: { userId: string; data: CourseProgressSnapshot }): Promise<CourseResultsDto> {
    await this.repository.saveSnapshot(userId, data);
    return this.repository.getResults(userId);
  }

  getResults({ userId }: { userId: string }): Promise<CourseResultsDto> {
    return this.repository.getResults(userId);
  }
}
