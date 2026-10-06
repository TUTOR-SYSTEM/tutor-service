import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import {
  CreateScheduleDto,
  CreateSchedulesDto,
  GetSchedulesQueryDto,
  UpdateScheduleDto,
} from '@packages/entities/schedule';
import { checkUuidValid } from '@packages/helpers';
import { ScheduleRepository } from './schedule.repository';
import { ClassService } from '../class/class.service';

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);
  constructor(
    private readonly repo: ScheduleRepository,
    private readonly classService: ClassService,
  ) {}

  // todo : ensure the acting user owns the target class ...
  private async assertClassOwner({ userId, classId }: { userId: string; classId: string }) {
    return this.classService.getOwnedClassService({ userId, id: classId });
  }

  private async loadOwnedSchedule({ userId, id }: { userId: string; id: string }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.SCHEDULE_ID_MUST_BE_UUID);

    const schedule = await this.repo.getById({ id });
    if (!schedule) throw new NotFoundException(ERROR_MESSAGES.SCHEDULE_NOT_FOUND);

    await this.assertClassOwner({ userId, classId: schedule.classId });
    return schedule;
  }

  async createScheduleService({ userId, data }: { userId: string; data: CreateScheduleDto }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);

    await this.assertClassOwner({ userId, classId: data.classId });
    return this.repo.create({ data });
  }

  async createSchedulesService({ userId, data }: { userId: string; data: CreateSchedulesDto }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);

    await this.assertClassOwner({ userId, classId: data.classId });
    return this.repo.createMany({ classId: data.classId, items: data.schedules });
  }

  async getSchedulesService({ userId, query }: { userId: string; query: GetSchedulesQueryDto }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);

    return this.repo.getAll({ userId, query });
  }

  async getSchedulesByClassService({ userId, classId }: { userId: string; classId: string }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);

    await this.assertClassOwner({ userId, classId });
    return this.repo.getByClass({ classId });
  }

  async getScheduleService({ userId, id }: { userId: string; id: string }) {
    return this.loadOwnedSchedule({ userId, id });
  }

  async updateScheduleService({
    userId,
    id,
    data,
  }: {
    userId: string;
    id: string;
    data: UpdateScheduleDto;
  }) {
    await this.loadOwnedSchedule({ userId, id });
    return this.repo.update({ id, data });
  }

  async delScheduleService({ userId, id }: { userId: string; id: string }) {
    await this.loadOwnedSchedule({ userId, id });

    const deleted = await this.repo.del({ id });
    if (!deleted) throw new NotFoundException(ERROR_MESSAGES.SCHEDULE_NOT_FOUND);

    return { id };
  }
}
