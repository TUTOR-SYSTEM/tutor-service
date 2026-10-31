import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, isRecordNotFound } from '../../database/prisma.service';
import {
  CreateScheduleDto,
  CreateSchedulesDto,
  GetSchedulesQueryDto,
  UpdateScheduleDto,
} from '@packages/entities/schedule';
import { buildListWhereClause, buildPagination } from '@packages/helpers';

@Injectable()
export class ScheduleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create({ data }: { data: CreateScheduleDto }) {
    return this.prisma.schedule.create({
      data: {
        classId: data.classId,
        dayOfWeek: data.dayOfWeek,
        startTime: data.startTime,
        endTime: data.endTime,
        format: data.format,
        location: data.location,
      },
    });
  }

  async createMany({
    classId,
    items,
  }: {
    classId: string;
    items: CreateSchedulesDto['schedules'];
  }) {
    return this.prisma.schedule.createManyAndReturn({
      data: items.map((item) => ({
        classId,
        dayOfWeek: item.dayOfWeek,
        startTime: item.startTime,
        endTime: item.endTime,
        format: item.format,
        location: item.location,
      })),
    });
  }

  // list every schedule across the classes the user owns (tutor) or is enrolled in (student)
  async getAll({
    userId,
    role,
    query,
  }: {
    userId: string;
    role?: string | null;
    query: GetSchedulesQueryDto;
  }) {
    const { page = 1, limit = 10, search, classId } = query;

    const searchWhere = buildListWhereClause({
      search,
      searchFields: ['location'],
      filters: { classId },
    }) as Prisma.ScheduleWhereInput | undefined;

    const accessWhere: Prisma.ScheduleWhereInput = {
      class: { OR: [{ tutorId: userId }, { students: { some: { studentId: userId } } }] },
    };
    const where: Prisma.ScheduleWhereInput = {
      AND: [accessWhere, ...(searchWhere ? [searchWhere] : [])],
    };

    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    const [total, rows] = await Promise.all([
      this.prisma.schedule.count({ where }),
      this.prisma.schedule.findMany({
        where,
        include: { class: { select: { id: true, name: true, code: true, subject: true } } },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        take: limitNumber,
        skip: (pageNumber - 1) * limitNumber,
      }),
    ]);

    return { schedules: rows, pagination: buildPagination(total, pageNumber, limitNumber) };
  }

  async getByClass({ classId }: { classId: string }) {
    return this.prisma.schedule.findMany({
      where: { classId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  async getById({ id }: { id: string }) {
    return this.prisma.schedule.findUnique({ where: { id } });
  }

  async update({ id, data }: { id: string; data: UpdateScheduleDto }) {
    try {
      return await this.prisma.schedule.update({
        where: { id },
        data: {
          dayOfWeek: data.dayOfWeek,
          startTime: data.startTime,
          endTime: data.endTime,
          format: data.format,
          location: data.location,
        },
      });
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  async del({ id }: { id: string }) {
    const { count } = await this.prisma.schedule.deleteMany({ where: { id } });
    return count > 0;
  }
}
