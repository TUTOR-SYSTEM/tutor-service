import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ERROR_MESSAGES } from 'src/data/constants';
import { ChapterService } from 'src/features/chapter/chapter.service';
import { ChapterRepository } from 'src/features/chapter/chapter.repository';
import { CurriculumRepository } from 'src/features/curriculum/curriculum.repository';

// the chapter repository pulls an ESM-only transitive dep (uuid) that jest cannot parse;
// the service only needs the repository token, so swap the module for a bare class
jest.mock('src/features/chapter/chapter.repository', () => ({
  ChapterRepository: class ChapterRepository {},
}));
jest.mock('src/features/curriculum/curriculum.repository', () => ({
  CurriculumRepository: class CurriculumRepository {},
}));

const CURRICULUM_ID = '11111111-1111-4111-8111-111111111111';
const CHAPTER_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_ID = '55555555-5555-4555-8555-555555555555';

describe('ChapterService', () => {
  let service: ChapterService;
  let repo: Record<string, jest.Mock>;
  let curriculumRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = {
      create: jest.fn(),
      curriculumExists: jest.fn().mockResolvedValue(true),
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    // the curriculum is owned by OWNER_ID unless a test says otherwise
    curriculumRepo = {
      findById: jest.fn().mockResolvedValue({ id: CURRICULUM_ID, userId: OWNER_ID }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterService,
        { provide: ChapterRepository, useValue: repo },
        { provide: CurriculumRepository, useValue: curriculumRepo },
      ],
    }).compile();

    service = module.get(ChapterService);
  });

  describe('createChapterService', () => {
    it('creates a chapter under a valid curriculum', async () => {
      repo.create.mockResolvedValue({ id: CHAPTER_ID });

      const result = await service.createChapterService({
        userId: OWNER_ID,
        curriculumId: CURRICULUM_ID,
        data: { name: 'Ch1' } as never,
      });

      expect(repo.create).toHaveBeenCalledWith({
        curriculumId: CURRICULUM_ID,
        data: { name: 'Ch1' },
      });
      expect(result).toEqual({ id: CHAPTER_ID });
    });

    it('rejects a non-UUID curriculumId without inserting', async () => {
      await expect(
        service.createChapterService({ userId: OWNER_ID, curriculumId: 'nope', data: {} as never }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.CURRICULUM_ID_MUST_BE_UUID));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('returns NotFound when the curriculum belongs to someone else', async () => {
      await expect(
        service.createChapterService({
          userId: OTHER_ID,
          curriculumId: CURRICULUM_ID,
          data: {} as never,
        }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CURRICULUM_NOT_FOUND));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('returns NotFound when the curriculum does not exist', async () => {
      curriculumRepo.findById.mockResolvedValue(undefined);

      await expect(
        service.createChapterService({
          userId: OWNER_ID,
          curriculumId: CURRICULUM_ID,
          data: {} as never,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects a missing/invalid acting userId', async () => {
      await expect(
        service.createChapterService({
          userId: '',
          curriculumId: CURRICULUM_ID,
          data: {} as never,
        }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID));
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('getAllChaptersService', () => {
    it('forwards curriculumId, page and limit to the repository', async () => {
      repo.findAll.mockResolvedValue({ chapters: [], pagination: {} });

      await service.getAllChaptersService({
        query: { curriculumId: CURRICULUM_ID, page: 2, limit: 10 } as never,
      });

      expect(repo.findAll).toHaveBeenCalledWith({
        curriculumId: CURRICULUM_ID,
        page: 2,
        limit: 10,
      });
    });

    it('rejects a missing curriculumId', async () => {
      await expect(
        service.getAllChaptersService({ query: { page: 1, limit: 10 } as never }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.findAll).not.toHaveBeenCalled();
    });
  });

  describe('getChapterByIdService', () => {
    it('returns the chapter when the id is valid', async () => {
      repo.findById.mockResolvedValue({ id: CHAPTER_ID });

      await expect(service.getChapterByIdService({ id: CHAPTER_ID })).resolves.toEqual({
        id: CHAPTER_ID,
      });
    });

    it('rejects a non-UUID id', async () => {
      await expect(service.getChapterByIdService({ id: 'x' })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.CHAPTER_ID_INVALID),
      );
      expect(repo.findById).not.toHaveBeenCalled();
    });
  });

  describe('updateChapterService', () => {
    it('updates an existing chapter', async () => {
      repo.findById.mockResolvedValue({ id: CHAPTER_ID, curriculumId: CURRICULUM_ID });
      repo.update.mockResolvedValue({ id: CHAPTER_ID, name: 'New' });

      await expect(
        service.updateChapterService({
          userId: OWNER_ID,
          id: CHAPTER_ID,
          data: { name: 'New' } as never,
        }),
      ).resolves.toEqual({ id: CHAPTER_ID, name: 'New' });
      expect(repo.update).toHaveBeenCalledWith(CHAPTER_ID, { name: 'New' });
    });

    it('returns NotFound and skips the update when the chapter is missing', async () => {
      repo.findById.mockResolvedValue(undefined);

      await expect(
        service.updateChapterService({ userId: OWNER_ID, id: CHAPTER_ID, data: {} as never }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CHAPTER_NOT_FOUND));
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("returns NotFound and skips the update when the curriculum isn't the caller's", async () => {
      repo.findById.mockResolvedValue({ id: CHAPTER_ID, curriculumId: CURRICULUM_ID });

      await expect(
        service.updateChapterService({ userId: OTHER_ID, id: CHAPTER_ID, data: {} as never }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CURRICULUM_NOT_FOUND));
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID id before looking anything up', async () => {
      await expect(
        service.updateChapterService({ userId: OWNER_ID, id: '', data: {} as never }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.findById).not.toHaveBeenCalled();
    });
  });

  describe('deleteChapterService', () => {
    it('deletes an existing chapter', async () => {
      repo.findById.mockResolvedValue({ id: CHAPTER_ID, curriculumId: CURRICULUM_ID });
      repo.delete.mockResolvedValue({ id: CHAPTER_ID });

      await expect(
        service.deleteChapterService({ userId: OWNER_ID, id: CHAPTER_ID }),
      ).resolves.toEqual({ id: CHAPTER_ID });
      expect(repo.delete).toHaveBeenCalledWith(CHAPTER_ID);
    });

    it('returns NotFound and does not delete a missing chapter', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.deleteChapterService({ userId: OWNER_ID, id: CHAPTER_ID }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it("does not delete a chapter of a curriculum the caller doesn't own", async () => {
      repo.findById.mockResolvedValue({ id: CHAPTER_ID, curriculumId: CURRICULUM_ID });

      await expect(
        service.deleteChapterService({ userId: OTHER_ID, id: CHAPTER_ID }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID id', async () => {
      await expect(service.deleteChapterService({ userId: OWNER_ID, id: 'x' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
