import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import { LessonRepository } from './lesson.repository';
import { CurriculumRepository } from '../curriculum/curriculum.repository';
import { DRIZZLE } from 'src/database/database.module';
import { drizzle } from 'drizzle-orm/postgres-js';
import {
  type CreateLessonBodyDto,
  type UpdateLessonDto,
  type GetLessonsQueryDto,
} from '@packages/entities';
import { checkUuidValid } from '@packages/helpers';

@Injectable()
export class LessonService {
  constructor(
    private readonly lessonRepository: LessonRepository,
    private readonly curriculumRepository: CurriculumRepository,
    @Inject(DRIZZLE) private readonly db: ReturnType<typeof drizzle>,
  ) {}

  /** Writes are limited to the curriculum's owner; anyone else gets a 404. */
  private async assertCurriculumOwner(curriculumId: string, userId: string) {
    if (!userId || !checkUuidValid({ data: userId })) {
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    }
    const curriculum = await this.curriculumRepository.findById(curriculumId);
    if (!curriculum || curriculum.userId !== userId) {
      throw new NotFoundException(ERROR_MESSAGES.CURRICULUM_NOT_FOUND);
    }
  }

  async createLessonService({
    userId,
    curriculumId,
    chapterId,
    data,
  }: {
    userId: string;
    curriculumId: string;
    chapterId?: string | null;
    data: CreateLessonBodyDto;
  }) {
    if (!curriculumId || !checkUuidValid({ data: curriculumId })) {
      throw new BadRequestException(ERROR_MESSAGES.CURRICULUM_ID_MUST_BE_UUID);
    }
    if (chapterId && !checkUuidValid({ data: chapterId })) {
      throw new BadRequestException(ERROR_MESSAGES.CHAPTER_ID_MUST_BE_UUID);
    }
    await this.assertCurriculumOwner(curriculumId, userId);
    return await this.lessonRepository.create({ curriculumId, chapterId, data });
  }

  async getAllLessonsService({ query }: { query: GetLessonsQueryDto }) {
    const { curriculumId, chapterId, page, limit } = query;
    if (!curriculumId || !checkUuidValid({ data: curriculumId })) {
      throw new BadRequestException(ERROR_MESSAGES.CURRICULUM_ID_MUST_BE_UUID);
    }
    if (chapterId && !checkUuidValid({ data: chapterId })) {
      throw new BadRequestException(ERROR_MESSAGES.CHAPTER_ID_MUST_BE_UUID);
    }
    return await this.lessonRepository.findAll({ curriculumId, chapterId, page, limit });
  }

  async getLessonByIdService({ id }: { id: string }) {
    if (!id || !checkUuidValid({ data: id })) {
      throw new BadRequestException(ERROR_MESSAGES.LESSON_ID_INVALID);
    }
    return await this.lessonRepository.findById(id);
  }

  async updateLessonService({
    userId,
    id,
    data,
  }: {
    userId: string;
    id: string;
    data: UpdateLessonDto;
  }) {
    if (!id || !checkUuidValid({ data: id })) {
      throw new BadRequestException(ERROR_MESSAGES.LESSON_ID_INVALID);
    }
    const existing = await this.lessonRepository.findById(id);
    if (!existing) throw new NotFoundException(ERROR_MESSAGES.LESSON_NOT_FOUND);
    await this.assertCurriculumOwner(existing.curriculumId, userId);
    // A lesson can't be moved to another curriculum through update — that would let a caller
    // graft content into (or out of) a curriculum they don't own.
    const { curriculumId: _ignored, ...safeData } = data;
    return await this.lessonRepository.update(id, safeData);
  }

  async deleteLessonService({ userId, id }: { userId: string; id: string }) {
    if (!id || !checkUuidValid({ data: id })) {
      throw new BadRequestException(ERROR_MESSAGES.LESSON_ID_INVALID);
    }
    const existing = await this.lessonRepository.findById(id);
    if (!existing) throw new NotFoundException(ERROR_MESSAGES.LESSON_NOT_FOUND);
    await this.assertCurriculumOwner(existing.curriculumId, userId);
    return await this.lessonRepository.delete(id);
  }
}
