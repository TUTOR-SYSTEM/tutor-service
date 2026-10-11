import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ERROR_MESSAGES } from 'src/data/constants';
import { ScheduleService } from 'src/features/schedule/schedule.service';
import { ScheduleRepository } from 'src/features/schedule/schedule.repository';
import { ClassService } from 'src/features/class/class.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const SCHEDULE_ID = '33333333-3333-4333-8333-333333333333';

describe('ScheduleService', () => {
  let service: ScheduleService;
  let repo: {
    create: jest.Mock;
    createMany: jest.Mock;
    getAll: jest.Mock;
    getByClass: jest.Mock;
    getById: jest.Mock;
    update: jest.Mock;
    del: jest.Mock;
  };
  let classService: { getOwnedClassService: jest.Mock };

  beforeEach(async () => {
    repo = {
      create: jest.fn(),
      createMany: jest.fn(),
      getAll: jest.fn(),
      getByClass: jest.fn(),
      getById: jest.fn(),
      update: jest.fn(),
      del: jest.fn(),
    };
    classService = { getOwnedClassService: jest.fn().mockResolvedValue({ id: CLASS_ID }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduleService,
        { provide: ScheduleRepository, useValue: repo },
        { provide: ClassService, useValue: classService },
      ],
    }).compile();

    service = module.get(ScheduleService);
  });

  describe('createScheduleService', () => {
    const data = { classId: CLASS_ID } as never;

    it('creates the schedule when the acting user owns the class', async () => {
      repo.create.mockResolvedValue({ id: SCHEDULE_ID });

      const result = await service.createScheduleService({ userId: USER_ID, data });

      expect(classService.getOwnedClassService).toHaveBeenCalledWith({
        userId: USER_ID,
        id: CLASS_ID,
      });
      expect(repo.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual({ id: SCHEDULE_ID });
    });

    it('rejects a non-UUID userId before touching the repository', async () => {
      await expect(service.createScheduleService({ userId: 'not-a-uuid', data })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID),
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('propagates the class ownership failure and does not create', async () => {
      classService.getOwnedClassService.mockRejectedValue(
        new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND),
      );

      await expect(service.createScheduleService({ userId: USER_ID, data })).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('surfaces a repository error from create', async () => {
      repo.create.mockRejectedValue(new Error('db down'));

      await expect(service.createScheduleService({ userId: USER_ID, data })).rejects.toThrow(
        'db down',
      );
    });
  });

  describe('createSchedulesService', () => {
    it('bulk-creates the items under the owned class', async () => {
      const schedules = [{ dayOfWeek: 1 }, { dayOfWeek: 3 }];
      repo.createMany.mockResolvedValue(schedules);

      const result = await service.createSchedulesService({
        userId: USER_ID,
        data: { classId: CLASS_ID, schedules } as never,
      });

      expect(repo.createMany).toHaveBeenCalledWith({ classId: CLASS_ID, items: schedules });
      expect(result).toEqual(schedules);
    });

    it('does not create anything when the user does not own the class', async () => {
      classService.getOwnedClassService.mockRejectedValue(
        new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND),
      );

      await expect(
        service.createSchedulesService({
          userId: USER_ID,
          data: { classId: CLASS_ID, schedules: [] } as never,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.createMany).not.toHaveBeenCalled();
    });
  });

  describe('getSchedulesService', () => {
    it('forwards the user and query to the repository', async () => {
      const query = { page: 1 } as never;
      repo.getAll.mockResolvedValue([]);

      await service.getSchedulesService({ userId: USER_ID, query });

      expect(repo.getAll).toHaveBeenCalledWith({ userId: USER_ID, query });
    });

    it('rejects an invalid userId', async () => {
      await expect(service.getSchedulesService({ userId: '', query: {} as never })).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.getAll).not.toHaveBeenCalled();
    });
  });

  describe('getSchedulesByClassService', () => {
    it('returns the class schedules after the ownership check', async () => {
      repo.getByClass.mockResolvedValue([{ id: SCHEDULE_ID }]);

      const result = await service.getSchedulesByClassService({
        userId: USER_ID,
        classId: CLASS_ID,
      });

      expect(result).toEqual([{ id: SCHEDULE_ID }]);
      expect(repo.getByClass).toHaveBeenCalledWith({ classId: CLASS_ID });
    });

    it('does not read when ownership fails', async () => {
      classService.getOwnedClassService.mockRejectedValue(new NotFoundException());

      await expect(
        service.getSchedulesByClassService({ userId: USER_ID, classId: CLASS_ID }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.getByClass).not.toHaveBeenCalled();
    });
  });

  describe('getScheduleService', () => {
    it('returns the schedule when it belongs to an owned class', async () => {
      repo.getById.mockResolvedValue({ id: SCHEDULE_ID, classId: CLASS_ID });

      const result = await service.getScheduleService({ userId: USER_ID, id: SCHEDULE_ID });

      expect(result).toEqual({ id: SCHEDULE_ID, classId: CLASS_ID });
      expect(classService.getOwnedClassService).toHaveBeenCalledWith({
        userId: USER_ID,
        id: CLASS_ID,
      });
    });

    it('rejects a non-UUID schedule id', async () => {
      await expect(service.getScheduleService({ userId: USER_ID, id: 'bad' })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.SCHEDULE_ID_MUST_BE_UUID),
      );
      expect(repo.getById).not.toHaveBeenCalled();
    });

    it('throws NotFound when the schedule does not exist', async () => {
      repo.getById.mockResolvedValue(null);

      await expect(
        service.getScheduleService({ userId: USER_ID, id: SCHEDULE_ID }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.SCHEDULE_NOT_FOUND));
      expect(classService.getOwnedClassService).not.toHaveBeenCalled();
    });

    it('throws when the schedule belongs to a class the user does not own', async () => {
      repo.getById.mockResolvedValue({ id: SCHEDULE_ID, classId: CLASS_ID });
      classService.getOwnedClassService.mockRejectedValue(new NotFoundException());

      await expect(
        service.getScheduleService({ userId: USER_ID, id: SCHEDULE_ID }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateScheduleService', () => {
    it('updates after the ownership check passes', async () => {
      repo.getById.mockResolvedValue({ id: SCHEDULE_ID, classId: CLASS_ID });
      repo.update.mockResolvedValue({ id: SCHEDULE_ID, dayOfWeek: 5 });

      const result = await service.updateScheduleService({
        userId: USER_ID,
        id: SCHEDULE_ID,
        data: { dayOfWeek: 5 } as never,
      });

      expect(repo.update).toHaveBeenCalledWith({ id: SCHEDULE_ID, data: { dayOfWeek: 5 } });
      expect(result).toEqual({ id: SCHEDULE_ID, dayOfWeek: 5 });
    });

    it('does not update a schedule the user does not own', async () => {
      repo.getById.mockResolvedValue({ id: SCHEDULE_ID, classId: CLASS_ID });
      classService.getOwnedClassService.mockRejectedValue(new NotFoundException());

      await expect(
        service.updateScheduleService({
          userId: USER_ID,
          id: SCHEDULE_ID,
          data: {} as never,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('does not update a missing schedule', async () => {
      repo.getById.mockResolvedValue(undefined);

      await expect(
        service.updateScheduleService({ userId: USER_ID, id: SCHEDULE_ID, data: {} as never }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('delScheduleService', () => {
    it('deletes an owned schedule and returns its id', async () => {
      repo.getById.mockResolvedValue({ id: SCHEDULE_ID, classId: CLASS_ID });
      repo.del.mockResolvedValue(true);

      const result = await service.delScheduleService({ userId: USER_ID, id: SCHEDULE_ID });

      expect(repo.del).toHaveBeenCalledWith({ id: SCHEDULE_ID });
      expect(result).toEqual({ id: SCHEDULE_ID });
    });

    it('throws NotFound when the delete affects no rows (race with another delete)', async () => {
      repo.getById.mockResolvedValue({ id: SCHEDULE_ID, classId: CLASS_ID });
      repo.del.mockResolvedValue(false);

      await expect(
        service.delScheduleService({ userId: USER_ID, id: SCHEDULE_ID }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.SCHEDULE_NOT_FOUND));
    });

    it('does not delete when the user does not own the class', async () => {
      repo.getById.mockResolvedValue({ id: SCHEDULE_ID, classId: CLASS_ID });
      classService.getOwnedClassService.mockRejectedValue(new NotFoundException());

      await expect(
        service.delScheduleService({ userId: USER_ID, id: SCHEDULE_ID }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.del).not.toHaveBeenCalled();
    });
  });

  describe('acting-user UUID guards', () => {
    it('createSchedulesService rejects a non-UUID userId before the ownership check', async () => {
      await expect(
        service.createSchedulesService({
          userId: 'not-a-uuid',
          data: { classId: CLASS_ID, schedules: [] } as never,
        }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID));
      expect(classService.getOwnedClassService).not.toHaveBeenCalled();
      expect(repo.createMany).not.toHaveBeenCalled();
    });

    it('getSchedulesByClassService rejects a non-UUID userId before the ownership check', async () => {
      await expect(
        service.getSchedulesByClassService({ userId: 'not-a-uuid', classId: CLASS_ID }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID));
      expect(classService.getOwnedClassService).not.toHaveBeenCalled();
      expect(repo.getByClass).not.toHaveBeenCalled();
    });

    it('getScheduleService rejects a non-UUID userId before loading the schedule', async () => {
      await expect(
        service.getScheduleService({ userId: 'not-a-uuid', id: SCHEDULE_ID }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID));
      expect(repo.getById).not.toHaveBeenCalled();
    });
  });
});
