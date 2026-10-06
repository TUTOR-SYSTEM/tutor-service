import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
import {
  CreateScheduleDto,
  CreateSchedulesDto,
  GetSchedulesQueryDto,
  UpdateScheduleDto,
} from '@packages/entities/schedule';
import { classStudents, classes, schedules } from 'src/database/schema';
import { buildListWhereClause } from '@packages/helpers';

@Injectable()
export class ScheduleRepository {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: ReturnType<typeof drizzle>,
  ) {}

  async create({ data }: { data: CreateScheduleDto }) {
    const [schedule] = await this.db
      .insert(schedules)
      .values({
        classId: data.classId,
        dayOfWeek: data.dayOfWeek,
        startTime: data.startTime,
        endTime: data.endTime,
        format: data.format,
        location: data.location,
      })
      .returning();
    return schedule;
  }

  async createMany({
    classId,
    items,
  }: {
    classId: string;
    items: CreateSchedulesDto['schedules'];
  }) {
    const rows = await this.db
      .insert(schedules)
      .values(
        items.map((item) => ({
          classId,
          dayOfWeek: item.dayOfWeek,
          startTime: item.startTime,
          endTime: item.endTime,
          format: item.format,
          location: item.location,
        })),
      )
      .returning();
    return rows;
  }

  // list every schedule across the classes the user owns (tutor) or is enrolled in (student)
  async getAll({ userId, query }: { userId: string; query: GetSchedulesQueryDto }) {
    const { page = 1, limit = 10, search, classId } = query;

    const ownedClassIds = this.db
      .select({ id: classes.id })
      .from(classes)
      .where(eq(classes.tutorId, userId));

    const enrolledClassIds = this.db
      .select({ id: classStudents.classId })
      .from(classStudents)
      .where(eq(classStudents.studentId, userId));

    const searchWhere = buildListWhereClause({
      search,
      searchableColumns: { location: { column: schedules.location } },
      filters: { classId },
      filterColumns: {
        classId: { column: schedules.classId },
      },
    });

    const accessWhere = or(
      inArray(schedules.classId, ownedClassIds),
      inArray(schedules.classId, enrolledClassIds),
    );
    const whereClause = and(...[searchWhere, accessWhere].filter((c) => c !== undefined));

    const [totalRow] = await this.db.select({ total: count() }).from(schedules).where(whereClause);
    const total = Number(totalRow?.total ?? 0);
    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    const offset = (pageNumber - 1) * limitNumber;

    const rows = await this.db
      .select({
        schedule: schedules,
        class: {
          id: classes.id,
          name: classes.name,
          code: classes.code,
          subject: classes.subject,
        },
      })
      .from(schedules)
      .leftJoin(classes, eq(schedules.classId, classes.id))
      .where(whereClause)
      .orderBy(asc(schedules.dayOfWeek), asc(schedules.startTime))
      .limit(limitNumber)
      .offset(offset);

    return {
      schedules: rows.map((row) => ({ ...row.schedule, class: row.class })),
      pagination: {
        total,
        page: pageNumber,
        limit: limitNumber,
        totalPages: Math.ceil(total / limitNumber),
      },
    };
  }

  async getByClass({ classId }: { classId: string }) {
    return this.db
      .select()
      .from(schedules)
      .where(eq(schedules.classId, classId))
      .orderBy(asc(schedules.dayOfWeek), asc(schedules.startTime));
  }

  async getById({ id }: { id: string }) {
    const [schedule] = await this.db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
    return schedule;
  }

  async update({ id, data }: { id: string; data: UpdateScheduleDto }) {
    const [schedule] = await this.db
      .update(schedules)
      .set({
        dayOfWeek: data.dayOfWeek,
        startTime: data.startTime,
        endTime: data.endTime,
        format: data.format,
        location: data.location,
        updatedAt: new Date(),
      })
      .where(eq(schedules.id, id))
      .returning();
    return schedule;
  }

  async del({ id }: { id: string }) {
    const [schedule] = await this.db.delete(schedules).where(eq(schedules.id, id)).returning();
    return !!schedule;
  }
}
