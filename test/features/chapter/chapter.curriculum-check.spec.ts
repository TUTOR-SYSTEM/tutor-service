import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ERROR_MESSAGES } from 'src/data/constants';
import { ChapterService } from 'src/features/chapter/chapter.service';
import { ChapterRepository } from 'src/features/chapter/chapter.repository';
import { CurriculumRepository } from 'src/features/curriculum/curriculum.repository';

// same workaround as chapter.service.spec.ts: the real repositories pull an ESM-only
// transitive dep (uuid) that jest cannot parse; the service only needs the repository tokens
jest.mock('src/features/chapter/chapter.repository', () => ({
  ChapterRepository: class ChapterRepository {},
}));
jest.mock('src/features/curriculum/curriculum.repository', () => ({
  CurriculumRepository: class CurriculumRepository {},
}));

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';
const CURRICULUM_ID = '11111111-1111-4111-8111-111111111111';
const MISSING_CURRICULUM_ID = '99999999-9999-4999-8999-999999999999';
const CHAPTER_ID = '22222222-2222-4222-8222-222222222222';

// Merge decision (bugs/merge-tutor.md, TUT3-02): chapter create is limited to the curriculum's
// owner. A missing curriculum and someone else's curriculum both surface as NotFound before any
// insert.
describe('ChapterService.createChapterService — curriculum owner check', () => {
  let service: ChapterService;
  let repo: Record<string, jest.Mock>;
  let curriculumRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = {
      create: jest.fn().mockResolvedValue({ id: CHAPTER_ID }),
      curriculumExists: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
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

  it('AC1: throws NotFoundException(CURRICULUM_NOT_FOUND) for a missing curriculum and does not insert', async () => {
    curriculumRepo.findById.mockResolvedValue(null);

    await expect(
      service.createChapterService({
        userId: OWNER_ID,
        curriculumId: MISSING_CURRICULUM_ID,
        data: { title: 'Ch1' } as never,
      }),
    ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CURRICULUM_NOT_FOUND));

    expect(curriculumRepo.findById).toHaveBeenCalledWith(MISSING_CURRICULUM_ID);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('AC2: throws NotFoundException for a curriculum owned by another user and does not insert', async () => {
    await expect(
      service.createChapterService({
        userId: OTHER_USER_ID,
        curriculumId: CURRICULUM_ID,
        data: { title: 'Ch1' } as never,
      }),
    ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CURRICULUM_NOT_FOUND));

    expect(repo.create).not.toHaveBeenCalled();
  });

  it('AC3: creates the chapter for the curriculum owner', async () => {
    const result = await service.createChapterService({
      userId: OWNER_ID,
      curriculumId: CURRICULUM_ID,
      data: { title: 'Ch1' } as never,
    });

    expect(repo.create).toHaveBeenCalledWith({
      curriculumId: CURRICULUM_ID,
      data: { title: 'Ch1' },
    });
    expect(result).toEqual({ id: CHAPTER_ID });
  });

  it('AC4: a non-UUID curriculumId fails with CURRICULUM_ID_MUST_BE_UUID and never touches the repos', async () => {
    await expect(
      service.createChapterService({
        userId: OWNER_ID,
        curriculumId: 'not-a-uuid',
        data: {} as never,
      }),
    ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.CURRICULUM_ID_MUST_BE_UUID));

    expect(curriculumRepo.findById).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });
});
