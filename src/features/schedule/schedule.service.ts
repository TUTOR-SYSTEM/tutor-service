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

// "HH:mm" strings compare correctly as text
function assertTimeRange(startTime: string | undefined, endTime: string | undefined) {
  if (startTime && endTime && startTime >= endTime)
    throw new BadRequestException(ERROR_MESSAGES.TIME_RANGE_INVALID);
}

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);
  constructor(
    private readonly repo: ScheduleRepository,
    private readonly classService: ClassService,
  ) {}

  // write gate: the class owner (tutor) or ADMIN
  private async assertClassOwner({
    userId,
    role,
    classId,
  }: {
    userId: string;
    role?: string | null;
    classId: string;
  }) {
    return this.classService.getOwnedClassService({ userId, role, id: classId });
  }

  // read gate: owner, enrolled student, parent of an enrolled student, or ADMIN
  private async assertClassReadable({
    userId,
    role,
    classId,
  }: {
    userId: string;
    role?: string | null;
    classId: string;
  }) {
    return this.classService.getAccessibleClassService({ userId, role, id: classId });
  }

  private async loadOwnedSchedule({
    userId,
    role,
    id,
  }: {
    userId: string;
    role?: string | null;
    id: string;
  }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.SCHEDULE_ID_MUST_BE_UUID);

    const schedule = await this.repo.getById({ id });
    if (!schedule) throw new NotFoundException(ERROR_MESSAGES.SCHEDULE_NOT_FOUND);

    await this.assertClassOwner({ userId, role, classId: schedule.classId });
    return schedule;
  }

  async createScheduleService({
    userId,
    role,
    data,
  }: {
    userId: string;
    role?: string | null;
    data: CreateScheduleDto;
  }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);

    assertTimeRange(data.startTime, data.endTime);
    await this.assertClassOwner({ userId, role, classId: data.classId });
    return this.repo.create({ data });
  }

  async createSchedulesService({
    userId,
    role,
    data,
  }: {
    userId: string;
    role?: string | null;
    data: CreateSchedulesDto;
  }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);

    for (const item of data.schedules) assertTimeRange(item.startTime, item.endTime);
    await this.assertClassOwner({ userId, role, classId: data.classId });
    return this.repo.createMany({ classId: data.classId, items: data.schedules });
  }

  async getSchedulesService({
    userId,
    role,
    query,
  }: {
    userId: string;
    role?: string | null;
    query: GetSchedulesQueryDto;
  }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);

    return this.repo.getAll({ userId, role, query });
  }

  async getSchedulesByClassService({
    userId,
    role,
    classId,
  }: {
    userId: string;
    role?: string | null;
    classId: string;
  }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);

    await this.assertClassReadable({ userId, role, classId });
    return this.repo.getByClass({ classId });
  }

  async getScheduleService({
    userId,
    role,
    id,
  }: {
    userId: string;
    role?: string | null;
    id: string;
  }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.SCHEDULE_ID_MUST_BE_UUID);

    const schedule = await this.repo.getById({ id });
    if (!schedule) throw new NotFoundException(ERROR_MESSAGES.SCHEDULE_NOT_FOUND);

    await this.assertClassReadable({ userId, role, classId: schedule.classId });
    return schedule;
  }

  async updateScheduleService({
    userId,
    role,
    id,
    data,
  }: {
    userId: string;
    role?: string | null;
    id: string;
    data: UpdateScheduleDto;
  }) {
    const current = await this.loadOwnedSchedule({ userId, role, id });
    // a partial update is checked against the stored value for the other bound
    assertTimeRange(data.startTime ?? current.startTime, data.endTime ?? current.endTime);
    return this.repo.update({ id, data });
  }

  async delScheduleService({
    userId,
    role,
    id,
  }: {
    userId: string;
    role?: string | null;
    id: string;
  }) {
    await this.loadOwnedSchedule({ userId, role, id });

    const deleted = await this.repo.del({ id });
    if (!deleted) throw new NotFoundException(ERROR_MESSAGES.SCHEDULE_NOT_FOUND);

    return { id };
  }
}
