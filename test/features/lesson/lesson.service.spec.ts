import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ERROR_MESSAGES } from 'src/data/constants';
import { LessonService } from 'src/features/lesson/lesson.service';
import { LessonRepository } from 'src/features/lesson/lesson.repository';
import { CurriculumRepository } from 'src/features/curriculum/curriculum.repository';
import { DRIZZLE } from 'src/database/database.module';

// the lesson repository pulls drizzle + an ESM-only transitive dep (uuid) that jest cannot parse;
// the service only needs the repository token, so swap the module for a bare class
jest.mock('src/features/lesson/lesson.repository', () => ({
  LessonRepository: class LessonRepository {},
}));
jest.mock('src/features/curriculum/curriculum.repository', () => ({
  CurriculumRepository: class CurriculumRepository {},
}));

const CURRICULUM_ID = '11111111-1111-4111-8111-111111111111';
const CHAPTER_ID = '22222222-2222-4222-8222-222222222222';
const LESSON_ID = '33333333-3333-4333-8333-333333333333';
const OWNER_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_ID = '55555555-5555-4555-8555-555555555555';

describe('LessonService', () => {
  let service: LessonService;
  let repo: Record<string, jest.Mock>;
  let curriculumRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = {
      create: jest.fn(),
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
        LessonService,
        { provide: LessonRepository, useValue: repo },
        { provide: CurriculumRepository, useValue: curriculumRepo },
        { provide: DRIZZLE, useValue: {} },
      ],
    }).compile();

    service = module.get(LessonService);
  });

  describe('createLessonService', () => {
    it('creates a lesson with a null chapter when none is given', async () => {
      repo.create.mockResolvedValue({ id: LESSON_ID });

      await service.createLessonService({
        userId: OWNER_ID,
        curriculumId: CURRICULUM_ID,
        chapterId: null,
        data: { title: 'L1' } as never,
      });

      expect(repo.create).toHaveBeenCalledWith({
        curriculumId: CURRICULUM_ID,
        chapterId: null,
        data: { title: 'L1' },
      });
    });

    it('creates a lesson under a valid chapter', async () => {
      repo.create.mockResolvedValue({ id: LESSON_ID });

      await service.createLessonService({
        userId: OWNER_ID,
        curriculumId: CURRICULUM_ID,
        chapterId: CHAPTER_ID,
        data: {} as never,
      });

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ chapterId: CHAPTER_ID }));
    });

    it('rejects a non-UUID curriculumId', async () => {
      await expect(
        service.createLessonService({ userId: OWNER_ID, curriculumId: '', data: {} as never }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.CURRICULUM_ID_MUST_BE_UUID));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('returns NotFound when the curriculum belongs to someone else', async () => {
      await expect(
        service.createLessonService({
          userId: OTHER_ID,
          curriculumId: CURRICULUM_ID,
          data: {} as never,
        }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CURRICULUM_NOT_FOUND));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects a malformed (but present) chapterId', async () => {
      await expect(
        service.createLessonService({
          userId: OWNER_ID,
          curriculumId: CURRICULUM_ID,
          chapterId: 'bad',
          data: {} as never,
        }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.CHAPTER_ID_MUST_BE_UUID));
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('getAllLessonsService', () => {
    it('forwards filters and pagination to the repository', async () => {
      repo.findAll.mockResolvedValue({ lessons: [], pagination: {} });

      await service.getAllLessonsService({
        query: { curriculumId: CURRICULUM_ID, chapterId: CHAPTER_ID, page: 1, limit: 5 } as never,
      });

      expect(repo.findAll).toHaveBeenCalledWith({
        curriculumId: CURRICULUM_ID,
        chapterId: CHAPTER_ID,
        page: 1,
        limit: 5,
      });
    });

    it('allows listing without a chapter filter', async () => {
      repo.findAll.mockResolvedValue({ lessons: [], pagination: {} });

      await service.getAllLessonsService({
        query: { curriculumId: CURRICULUM_ID, page: 1, limit: 5 } as never,
      });

      expect(repo.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ curriculumId: CURRICULUM_ID, chapterId: undefined }),
      );
    });

    it('rejects a malformed chapterId filter', async () => {
      await expect(
        service.getAllLessonsService({
          query: { curriculumId: CURRICULUM_ID, chapterId: 'x', page: 1, limit: 5 } as never,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.findAll).not.toHaveBeenCalled();
    });
  });

  describe('getLessonByIdService', () => {
    it('returns the lesson for a valid id', async () => {
      repo.findById.mockResolvedValue({ id: LESSON_ID });

      await expect(service.getLessonByIdService({ id: LESSON_ID })).resolves.toEqual({
        id: LESSON_ID,
      });
    });

    it('returns null (not throw) when the lesson is absent, so callers can decide', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.getLessonByIdService({ id: LESSON_ID })).resolves.toBeNull();
    });

    it('rejects a non-UUID id', async () => {
      await expect(service.getLessonByIdService({ id: 'x' })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.LESSON_ID_INVALID),
      );
    });
  });

  describe('updateLessonService / deleteLessonService', () => {
    it('updates an existing lesson', async () => {
      repo.findById.mockResolvedValue({ id: LESSON_ID, curriculumId: CURRICULUM_ID });
      repo.update.mockResolvedValue({ id: LESSON_ID, title: 'New' });

      await expect(
        service.updateLessonService({
          userId: OWNER_ID,
          id: LESSON_ID,
          data: { title: 'New' } as never,
        }),
      ).resolves.toEqual({ id: LESSON_ID, title: 'New' });
    });

    it('never lets an update move the lesson to another curriculum', async () => {
      repo.findById.mockResolvedValue({ id: LESSON_ID, curriculumId: CURRICULUM_ID });
      repo.update.mockResolvedValue({ id: LESSON_ID });

      await service.updateLessonService({
        userId: OWNER_ID,
        id: LESSON_ID,
        data: { title: 'New', curriculumId: OTHER_ID } as never,
      });

      expect(repo.update).toHaveBeenCalledWith(LESSON_ID, { title: 'New' });
    });

    it('returns NotFound and does not update a missing lesson', async () => {
      repo.findById.mockResolvedValue(undefined);

      await expect(
        service.updateLessonService({ userId: OWNER_ID, id: LESSON_ID, data: {} as never }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.LESSON_NOT_FOUND));
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("does not update a lesson of a curriculum the caller doesn't own", async () => {
      repo.findById.mockResolvedValue({ id: LESSON_ID, curriculumId: CURRICULUM_ID });

      await expect(
        service.updateLessonService({ userId: OTHER_ID, id: LESSON_ID, data: {} as never }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CURRICULUM_NOT_FOUND));
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('deletes an existing lesson', async () => {
      repo.findById.mockResolvedValue({ id: LESSON_ID, curriculumId: CURRICULUM_ID });
      repo.delete.mockResolvedValue({ id: LESSON_ID });

      await expect(
        service.deleteLessonService({ userId: OWNER_ID, id: LESSON_ID }),
      ).resolves.toEqual({ id: LESSON_ID });
    });

    it('returns NotFound and does not delete a missing lesson', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.deleteLessonService({ userId: OWNER_ID, id: LESSON_ID }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it("does not delete a lesson of a curriculum the caller doesn't own", async () => {
      repo.findById.mockResolvedValue({ id: LESSON_ID, curriculumId: CURRICULUM_ID });

      await expect(
        service.deleteLessonService({ userId: OTHER_ID, id: LESSON_ID }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID id on delete', async () => {
      await expect(service.deleteLessonService({ userId: OWNER_ID, id: '' })).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.findById).not.toHaveBeenCalled();
    });
  });

  describe('UUID guards on list and update', () => {
    it('getAllLessonsService rejects a non-UUID curriculumId and does not query', async () => {
      await expect(
        service.getAllLessonsService({ query: { curriculumId: 'x' } as never }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.CURRICULUM_ID_MUST_BE_UUID));
      expect(repo.findAll).not.toHaveBeenCalled();
    });

    it('updateLessonService rejects a non-UUID id and does not read or update', async () => {
      await expect(
        service.updateLessonService({ userId: OWNER_ID, id: 'x', data: {} as never }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.LESSON_ID_INVALID));
      expect(repo.findById).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });
  });
});
