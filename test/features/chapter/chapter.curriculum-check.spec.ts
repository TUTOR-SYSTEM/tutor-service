import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ERROR_MESSAGES } from 'src/data/constants';
import { ChapterService } from 'src/features/chapter/chapter.service';
import { ChapterRepository } from 'src/features/chapter/chapter.repository';
import { DRIZZLE } from 'src/database/database.module';

// same workaround as chapter.service.spec.ts: the real repository pulls drizzle + an ESM-only
// transitive dep (uuid) that jest cannot parse; the service only needs the repository token
jest.mock('src/features/chapter/chapter.repository', () => ({
  ChapterRepository: class ChapterRepository {},
}));

const CURRICULUM_ID = '11111111-1111-4111-8111-111111111111';
const MISSING_CURRICULUM_ID = '99999999-9999-4999-8999-999999999999';
const CHAPTER_ID = '22222222-2222-4222-8222-222222222222';

// BUG DEMO2-2: POST /chapter/:curriculumId with a well-formed UUID that does not exist used to
// reach repo.create and fail on the FK (500). Expected: NotFoundException(CURRICULUM_NOT_FOUND)
// before any insert.
describe('ChapterService.createChapterService — curriculum existence check', () => {
  let service: ChapterService;
  let repo: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = {
      create: jest.fn(),
      curriculumExists: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterService,
        { provide: ChapterRepository, useValue: repo },
        { provide: DRIZZLE, useValue: {} },
      ],
    }).compile();

    service = module.get(ChapterService);
  });

  it('AC1: throws NotFoundException(CURRICULUM_NOT_FOUND) for a well-formed but missing curriculum and does not insert', async () => {
    repo.curriculumExists.mockResolvedValue(false);
    repo.create.mockResolvedValue({ id: CHAPTER_ID });

    await expect(
      service.createChapterService({
        curriculumId: MISSING_CURRICULUM_ID,
        data: { title: 'Ch1' } as never,
      }),
    ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CURRICULUM_NOT_FOUND));

    expect(repo.curriculumExists).toHaveBeenCalledWith(MISSING_CURRICULUM_ID);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('AC2: creates the chapter when the curriculum exists (unchanged behaviour)', async () => {
    repo.curriculumExists.mockResolvedValue(true);
    repo.create.mockResolvedValue({ id: CHAPTER_ID });

    const result = await service.createChapterService({
      curriculumId: CURRICULUM_ID,
      data: { title: 'Ch1' } as never,
    });

    expect(repo.curriculumExists).toHaveBeenCalledWith(CURRICULUM_ID);
    expect(repo.create).toHaveBeenCalledWith({
      curriculumId: CURRICULUM_ID,
      data: { title: 'Ch1' },
    });
    expect(result).toEqual({ id: CHAPTER_ID });
  });

  it('AC3: a non-UUID curriculumId still fails with CURRICULUM_ID_MUST_BE_UUID and never touches the repo', async () => {
    await expect(
      service.createChapterService({ curriculumId: 'not-a-uuid', data: {} as never }),
    ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.CURRICULUM_ID_MUST_BE_UUID));

    expect(repo.curriculumExists).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });
});
