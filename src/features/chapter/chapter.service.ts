import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import { ChapterRepository } from './chapter.repository';
import { CurriculumRepository } from '../curriculum/curriculum.repository';
import {
  type CreateChapterDto,
  type UpdateChapterDto,
  type GetChaptersQueryDto,
} from '@packages/entities';
import { canActOnOwned, checkUuidValid } from '@packages/helpers';

@Injectable()
export class ChapterService {
  constructor(
    private readonly chapterRepository: ChapterRepository,
    private readonly curriculumRepository: CurriculumRepository,
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

  async createChapterService({
    userId,
    role,
    curriculumId,
    data,
  }: {
    userId: string;
    role?: string | null;
    curriculumId: string;
    data: CreateChapterDto;
  }) {
    if (!curriculumId || !checkUuidValid({ data: curriculumId })) {
      throw new BadRequestException(ERROR_MESSAGES.CURRICULUM_ID_MUST_BE_UUID);
    }
    await this.assertCurriculumOwner(curriculumId, userId, role);
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
    // catalog read (no owner check); a missing chapter is a 404, never null + 200
    const chapter = await this.chapterRepository.findById(id);
    if (!chapter) throw new NotFoundException(ERROR_MESSAGES.CHAPTER_NOT_FOUND);
    return chapter;
  }

  async updateChapterService({
    userId,
    role,
    id,
    data,
  }: {
    userId: string;
    role?: string | null;
    id: string;
    data: UpdateChapterDto;
  }) {
    if (!id || !checkUuidValid({ data: id })) {
      throw new BadRequestException(ERROR_MESSAGES.CHAPTER_ID_INVALID);
    }
    const existing = await this.chapterRepository.findById(id);
    if (!existing) throw new NotFoundException(ERROR_MESSAGES.CHAPTER_NOT_FOUND);
    await this.assertCurriculumOwner(existing.curriculumId, userId, role);
    return await this.chapterRepository.update(id, data);
  }

  async deleteChapterService({
    userId,
    role,
    id,
  }: {
    userId: string;
    role?: string | null;
    id: string;
  }) {
    if (!id || !checkUuidValid({ data: id })) {
      throw new BadRequestException(ERROR_MESSAGES.CHAPTER_ID_INVALID);
    }
    const existing = await this.chapterRepository.findById(id);
    if (!existing) throw new NotFoundException(ERROR_MESSAGES.CHAPTER_NOT_FOUND);
    await this.assertCurriculumOwner(existing.curriculumId, userId, role);
    return await this.chapterRepository.delete(id);
  }
}
