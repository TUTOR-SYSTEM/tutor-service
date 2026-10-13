import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ERROR_MESSAGES } from 'src/data/constants';
import { CurriculumService } from 'src/features/curriculum/curriculum.service';
import { CurriculumRepository } from 'src/features/curriculum/curriculum.repository';
import { UserService } from 'src/features/user/user.service';

// the curriculum repository pulls drizzle + an ESM-only transitive dep (uuid) that jest cannot parse;
// the service only needs the repository token, so swap the module for a bare class
jest.mock('src/features/curriculum/curriculum.repository', () => ({
  CurriculumRepository: class CurriculumRepository {},
}));

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CURRICULUM_ID = '22222222-2222-4222-8222-222222222222';

describe('CurriculumService', () => {
  let service: CurriculumService;
  let repo: Record<string, jest.Mock>;
  let userService: { userExists: jest.Mock; getUserRoleById: jest.Mock };

  beforeEach(async () => {
    repo = {
      findByCode: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      findByIdWithDetails: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    userService = {
      userExists: jest.fn().mockResolvedValue(true),
      getUserRoleById: jest.fn().mockResolvedValue({ id: USER_ID, role: 'TUTOR' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CurriculumService,
        { provide: CurriculumRepository, useValue: repo },
        { provide: UserService, useValue: userService },
      ],
    }).compile();

    service = module.get(CurriculumService);
  });

  describe('generateNewCodeService', () => {
    it('returns a generated code when it is unused', async () => {
      const code = await service.generateNewCodeService();

      expect(typeof code).toBe('string');
      expect(code).not.toHaveLength(0);
      expect(repo.findByCode).toHaveBeenCalledTimes(1);
      expect(repo.findByCode).toHaveBeenCalledWith(code);
    });

    it('gives up with Conflict after the retry budget is exhausted', async () => {
      repo.findByCode.mockResolvedValue({ id: 'taken' });

      await expect(service.generateNewCodeService()).rejects.toThrow(
        new ConflictException(ERROR_MESSAGES.UNABLE_TO_GENERATE_UNIQUE_CODE),
      );
      expect(repo.findByCode).toHaveBeenCalledTimes(5);
    });
  });

  describe('createCurriculumService', () => {
    it('creates the curriculum for an existing user', async () => {
      repo.create.mockResolvedValue({ id: CURRICULUM_ID });

      await expect(
        service.createCurriculumService({
          userId: USER_ID,
          createCurriculum: { subject: 'Math' } as never,
        }),
      ).resolves.toEqual({ id: CURRICULUM_ID });
      expect(repo.create).toHaveBeenCalledWith({ userId: USER_ID, data: { subject: 'Math' } });
    });

    it('rejects a user id that does not exist', async () => {
      userService.getUserRoleById.mockResolvedValue(null);

      await expect(
        service.createCurriculumService({ userId: USER_ID, createCurriculum: {} as never }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.USER_NOT_FOUND));
      expect(repo.create).not.toHaveBeenCalled();
    });

    // regression (TUT3-21): students and parents cannot author curricula
    it('rejects a STUDENT or PARENT actor and inserts nothing', async () => {
      userService.getUserRoleById.mockResolvedValue({ id: USER_ID, role: 'STUDENT' });

      await expect(
        service.createCurriculumService({ userId: USER_ID, createCurriculum: {} as never }),
      ).rejects.toThrow(new ForbiddenException(ERROR_MESSAGES.PERMISSION_DENIED));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID user id', async () => {
      await expect(
        service.createCurriculumService({ userId: 'x', createCurriculum: {} as never }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID));
    });
  });

  describe('getAllCurriculumService', () => {
    it('forwards page, limit and search to the repository', async () => {
      repo.findAll.mockResolvedValue({ curriculums: [], pagination: {} });

      await service.getAllCurriculumService({
        userId: USER_ID,
        query: { page: 1, limit: 20, search: 'mat' } as never,
      });

      expect(repo.findAll).toHaveBeenCalledWith({ page: 1, limit: 20, search: 'mat' });
    });

    it('rejects an unknown user before listing', async () => {
      userService.userExists.mockResolvedValue(false);

      await expect(
        service.getAllCurriculumService({ userId: USER_ID, query: {} as never }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.findAll).not.toHaveBeenCalled();
    });
  });

  describe('getCurriculumByIdService', () => {
    it('returns the curriculum with details', async () => {
      repo.findByIdWithDetails.mockResolvedValue({ id: CURRICULUM_ID, chapters: [] });

      await expect(
        service.getCurriculumByIdService({ userId: USER_ID, id: CURRICULUM_ID }),
      ).resolves.toEqual({ id: CURRICULUM_ID, chapters: [] });
    });

    it('rejects a non-UUID curriculum id', async () => {
      await expect(service.getCurriculumByIdService({ userId: USER_ID, id: 'x' })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.CURRICULUM_ID_INVALID),
      );
      expect(repo.findByIdWithDetails).not.toHaveBeenCalled();
    });
  });

  describe('updateCurriculumService / deleteCurriculumService', () => {
    it("returns NotFound and skips the update for someone else's curriculum", async () => {
      repo.findById.mockResolvedValue({ id: CURRICULUM_ID, userId: 'someone-else' });

      await expect(
        service.updateCurriculumService({ userId: USER_ID, id: CURRICULUM_ID, data: {} as never }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CURRICULUM_NOT_FOUND));
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("returns NotFound and skips the delete for someone else's curriculum", async () => {
      repo.findById.mockResolvedValue({ id: CURRICULUM_ID, userId: 'someone-else' });

      await expect(
        service.deleteCurriculumService({ userId: USER_ID, id: CURRICULUM_ID }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CURRICULUM_NOT_FOUND));
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('updates an existing curriculum', async () => {
      repo.findById.mockResolvedValue({ id: CURRICULUM_ID, userId: USER_ID });
      repo.update.mockResolvedValue({ id: CURRICULUM_ID, subject: 'Physics' });

      await expect(
        service.updateCurriculumService({
          userId: USER_ID,
          id: CURRICULUM_ID,
          data: { subject: 'Physics' } as never,
        }),
      ).resolves.toEqual({ id: CURRICULUM_ID, subject: 'Physics' });
    });

    it('returns NotFound and skips the update for a missing curriculum', async () => {
      repo.findById.mockResolvedValue(undefined);

      await expect(
        service.updateCurriculumService({ userId: USER_ID, id: CURRICULUM_ID, data: {} as never }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CURRICULUM_NOT_FOUND));
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('deletes an existing curriculum', async () => {
      repo.findById.mockResolvedValue({ id: CURRICULUM_ID, userId: USER_ID });
      repo.delete.mockResolvedValue({ id: CURRICULUM_ID });

      await expect(
        service.deleteCurriculumService({ userId: USER_ID, id: CURRICULUM_ID }),
      ).resolves.toEqual({ id: CURRICULUM_ID });
    });

    it('returns NotFound and skips the delete for a missing curriculum', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.deleteCurriculumService({ userId: USER_ID, id: CURRICULUM_ID }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('rejects an unknown acting user on delete', async () => {
      userService.userExists.mockResolvedValue(false);

      await expect(
        service.deleteCurriculumService({ userId: USER_ID, id: CURRICULUM_ID }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.findById).not.toHaveBeenCalled();
    });
  });

  describe('UUID guards on list, read, update and delete', () => {
    it.each([
      [
        'getAllCurriculumService',
        (userId: string) => service.getAllCurriculumService({ userId, query: {} as never }),
      ],
      [
        'getCurriculumByIdService',
        (userId: string) => service.getCurriculumByIdService({ userId, id: CURRICULUM_ID }),
      ],
      [
        'updateCurriculumService',
        (userId: string) =>
          service.updateCurriculumService({ userId, id: CURRICULUM_ID, data: {} as never }),
      ],
      [
        'deleteCurriculumService',
        (userId: string) => service.deleteCurriculumService({ userId, id: CURRICULUM_ID }),
      ],
    ])('%s rejects a non-UUID user id before any lookup', async (_name, call) => {
      await expect(call('not-a-uuid')).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID),
      );
      expect(userService.userExists).not.toHaveBeenCalled();
    });

    it('updateCurriculumService rejects a non-UUID curriculum id and does not update', async () => {
      await expect(
        service.updateCurriculumService({ userId: USER_ID, id: 'x', data: {} as never }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.CURRICULUM_ID_INVALID));
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('deleteCurriculumService rejects a non-UUID curriculum id and does not delete', async () => {
      await expect(service.deleteCurriculumService({ userId: USER_ID, id: 'x' })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.CURRICULUM_ID_INVALID),
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });

  describe('acting user existence checks', () => {
    it('getCurriculumByIdService rejects a user that does not exist', async () => {
      userService.userExists.mockResolvedValueOnce(false);

      await expect(
        service.getCurriculumByIdService({ userId: USER_ID, id: CURRICULUM_ID }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.USER_NOT_FOUND));
      expect(repo.findByIdWithDetails).not.toHaveBeenCalled();
    });

    it('updateCurriculumService rejects a user that does not exist', async () => {
      userService.userExists.mockResolvedValueOnce(false);

      await expect(
        service.updateCurriculumService({ userId: USER_ID, id: CURRICULUM_ID, data: {} as never }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.USER_NOT_FOUND));
      expect(repo.update).not.toHaveBeenCalled();
    });
  });
});
