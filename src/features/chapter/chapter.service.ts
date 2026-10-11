import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import { ChapterRepository } from './chapter.repository';
import { CurriculumRepository } from '../curriculum/curriculum.repository';
import { DRIZZLE } from 'src/database/database.module';
import { drizzle } from 'drizzle-orm/postgres-js';
import {
  type CreateChapterDto,
  type UpdateChapterDto,
  type GetChaptersQueryDto,
} from '@packages/entities';
import { checkUuidValid } from '@packages/helpers';

@Injectable()
export class ChapterService {
  constructor(
    private readonly chapterRepository: ChapterRepository,
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

  async createChapterService({
    userId,
    curriculumId,
    data,
  }: {
    userId: string;
    curriculumId: string;
    data: CreateChapterDto;
  }) {
    if (!curriculumId || !checkUuidValid({ data: curriculumId })) {
      throw new BadRequestException(ERROR_MESSAGES.CURRICULUM_ID_MUST_BE_UUID);
    }
    await this.assertCurriculumOwner(curriculumId, userId);
    return await this.chapterRepository.create({ curriculumId, data });
  }

  async getAllChaptersService({ query }: { query: GetChaptersQueryDto }) {
    const { curriculumId, page, limit } = query;
    if (!curriculumId || !checkUuidValid({ data: curriculumId })) {
      throw new BadRequestException(ERROR_MESSAGES.CURRICULUM_ID_MUST_BE_UUID);
    }
    return await this.chapterRepository.findAll({ curriculumId, page, limit });
  }

  async getChapterByIdService({ id }: { id: string }) {
    if (!id || !checkUuidValid({ data: id })) {
      throw new BadRequestException(ERROR_MESSAGES.CHAPTER_ID_INVALID);
    }
    return await this.chapterRepository.findById(id);
  }

  async updateChapterService({
    userId,
    id,
    data,
  }: {
    userId: string;
    id: string;
    data: UpdateChapterDto;
  }) {
    if (!id || !checkUuidValid({ data: id })) {
      throw new BadRequestException(ERROR_MESSAGES.CHAPTER_ID_INVALID);
    }
    const existing = await this.chapterRepository.findById(id);
    if (!existing) throw new NotFoundException(ERROR_MESSAGES.CHAPTER_NOT_FOUND);
    await this.assertCurriculumOwner(existing.curriculumId, userId);
    return await this.chapterRepository.update(id, data);
  }

  async deleteChapterService({ userId, id }: { userId: string; id: string }) {
    if (!id || !checkUuidValid({ data: id })) {
      throw new BadRequestException(ERROR_MESSAGES.CHAPTER_ID_INVALID);
    }
    const existing = await this.chapterRepository.findById(id);
    if (!existing) throw new NotFoundException(ERROR_MESSAGES.CHAPTER_NOT_FOUND);
    await this.assertCurriculumOwner(existing.curriculumId, userId);
    return await this.chapterRepository.delete(id);
  }
}
