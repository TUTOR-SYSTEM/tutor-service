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
import { canActOnOwned, checkUuidValid } from '@packages/helpers';

@Injectable()
export class LessonService {
  constructor(
    private readonly lessonRepository: LessonRepository,
    private readonly curriculumRepository: CurriculumRepository,
    @Inject(DRIZZLE) private readonly db: ReturnType<typeof drizzle>,
  ) {}

  /** Writes are limited to the curriculum's owner (ADMIN bypasses); anyone else gets a 404. */
  private async assertCurriculumOwner(curriculumId: string, userId: string, role?: string | null) {
    if (!userId || !checkUuidValid({ data: userId })) {
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    }
    const curriculum = await this.curriculumRepository.findById(curriculumId);
    if (!curriculum || !canActOnOwned({ userId, role }, curriculum.userId)) {
      throw new NotFoundException(ERROR_MESSAGES.CURRICULUM_NOT_FOUND);
    }
  }

  // a lesson may only sit in a chapter of its own curriculum (no cross-curriculum grafting)
  private async assertChapterInCurriculum(chapterId: string, curriculumId: string) {
    const ok = await this.lessonRepository.chapterInCurriculum({ chapterId, curriculumId });
    if (!ok) throw new BadRequestException(ERROR_MESSAGES.LESSON_CHAPTER_MISMATCH);
  }

  async createLessonService({
    userId,
    role,
    curriculumId,
    chapterId,
    data,
  }: {
    userId: string;
    role?: string | null;
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
    await this.assertCurriculumOwner(curriculumId, userId, role);
    if (chapterId) await this.assertChapterInCurriculum(chapterId, curriculumId);
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
    // catalog read (no owner check); a missing lesson is a 404, never null + 200
    const lesson = await this.lessonRepository.findById(id);
    if (!lesson) throw new NotFoundException(ERROR_MESSAGES.LESSON_NOT_FOUND);
    return lesson;
  }

  async updateLessonService({
    userId,
    role,
    id,
    data,
  }: {
    userId: string;
    role?: string | null;
    id: string;
    data: UpdateLessonDto;
  }) {
    if (!id || !checkUuidValid({ data: id })) {
      throw new BadRequestException(ERROR_MESSAGES.LESSON_ID_INVALID);
    }
    const existing = await this.lessonRepository.findById(id);
    if (!existing) throw new NotFoundException(ERROR_MESSAGES.LESSON_NOT_FOUND);
    await this.assertCurriculumOwner(existing.curriculumId, userId, role);
    // A lesson can't be moved to another curriculum through update — that would let a caller
    // graft content into (or out of) a curriculum they don't own.
    const safeData: UpdateLessonDto = { ...data };
    delete safeData.curriculumId;
    if (safeData.chapterId) {
      await this.assertChapterInCurriculum(safeData.chapterId, existing.curriculumId);
    }
    // an empty update is a client error, not a no-op write (Drizzle rejects "no values to set")
    if (!Object.values(safeData).some((v) => v !== undefined)) {
      throw new BadRequestException(ERROR_MESSAGES.VALIDATION_FAILED);
    }
    return await this.lessonRepository.update(id, safeData);
  }

  async deleteLessonService({
    userId,
    role,
    id,
  }: {
    userId: string;
    role?: string | null;
    id: string;
  }) {
    if (!id || !checkUuidValid({ data: id })) {
      throw new BadRequestException(ERROR_MESSAGES.LESSON_ID_INVALID);
    }
    const existing = await this.lessonRepository.findById(id);
    if (!existing) throw new NotFoundException(ERROR_MESSAGES.LESSON_NOT_FOUND);
    await this.assertCurriculumOwner(existing.curriculumId, userId, role);
    return await this.lessonRepository.delete(id);
  }
}
