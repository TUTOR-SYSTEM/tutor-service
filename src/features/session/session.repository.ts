import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, isRecordNotFound } from '../../database/prisma.service';
import {
  CreateSessionDto,
  CreateSessionsDto,
  GetSessionsQueryDto,
  UpdateSessionDto,
} from '@packages/entities/session';
import { buildListWhereClause, buildPagination } from '@packages/helpers';
import { toDate } from '@packages/helpers/date.helper';

type SessionFields = CreateSessionDto | CreateSessionsDto['sessions'][number];

// shared column mapping for create / createMany / update (dates arrive as ISO strings over RPC)
const toSessionData = (item: SessionFields) => ({
  lessonId: item.lessonId,
  tutorId: item.tutorId,
  title: item.title,
  description: item.description,
  sessionNumber: item.sessionNumber,
  theoryUrls: item.theoryUrls,
  exerciseUrls: item.exerciseUrls,
  startAt: toDate(item.startAt),
  endAt: toDate(item.endAt),
  location: item.location,
  status: item.status,
  note: item.note,
  actualStartAt: toDate(item.actualStartAt),
  actualEndAt: toDate(item.actualEndAt),
  objectives: item.objectives,
  agenda: item.agenda,
  exerciseDueAt: toDate(item.exerciseDueAt),
});

@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create({ data }: { data: CreateSessionDto }) {
    return this.prisma.classSession.create({
      data: { ...toSessionData(data), classId: data.classId, sessionNumber: data.sessionNumber },
    });
  }

  async createMany({ classId, items }: { classId: string; items: CreateSessionsDto['sessions'] }) {
    return this.prisma.classSession.createManyAndReturn({
      data: items.map((item) => ({
        ...toSessionData(item),
        classId,
        sessionNumber: item.sessionNumber,
      })),
    });
  }

  // list every session across the classes the user owns (tutor) or is enrolled in (student)
  async getAll({
    userId,
    role,
    query,
  }: {
    userId: string;
    role?: string | null;
    query: GetSessionsQueryDto;
  }) {
    const { page = 1, limit = 10, search, status, classId, startDate, endDate } = query;

    const searchWhere = buildListWhereClause({
      search,
      searchFields: ['title'],
      filters: { status, classId },
    }) as Prisma.ClassSessionWhereInput | undefined;

    const accessWhere: Prisma.ClassSessionWhereInput = {
      class: { OR: [{ tutorId: userId }, { students: { some: { studentId: userId } } }] },
    };
    const from = toDate(startDate);
    const to = toDate(endDate);
    const dateWhere: Prisma.ClassSessionWhereInput | undefined =
      from || to ? { startAt: { ...(from && { gte: from }), ...(to && { lte: to }) } } : undefined;
    const where: Prisma.ClassSessionWhereInput = {
      AND: [accessWhere, ...(dateWhere ? [dateWhere] : []), ...(searchWhere ? [searchWhere] : [])],
    };

    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    const [total, rows] = await Promise.all([
      this.prisma.classSession.count({ where }),
      this.prisma.classSession.findMany({
        where,
        include: {
          class: { select: { id: true, name: true, code: true, subject: true, tutorId: true } },
        },
        orderBy: [{ startAt: 'desc' }, { id: 'asc' }],
        take: limitNumber,
        skip: (pageNumber - 1) * limitNumber,
      }),
    ]);

    return { sessions: rows, pagination: buildPagination(total, pageNumber, limitNumber) };
  }

  async getByClass({ classId }: { classId: string }) {
    return this.prisma.classSession.findMany({
      where: { classId },
      orderBy: [{ sessionNumber: 'asc' }, { startAt: 'asc' }],
    });
  }

  // session numbers already used in the class (optionally ignoring one session, for updates)
  async findTakenSessionNumbers({
    classId,
    numbers,
    excludeId,
  }: {
    classId: string;
    numbers: number[];
    excludeId?: string;
  }) {
    const rows = await this.db
      .select({ sessionNumber: sessions.sessionNumber })
      .from(sessions)
      .where(
        and(
          eq(sessions.classId, classId),
          inArray(sessions.sessionNumber, numbers),
          excludeId ? ne(sessions.id, excludeId) : undefined,
        ),
      );
    return rows.map((row) => row.sessionNumber);
  }

  async getById({ id }: { id: string }) {
    return this.prisma.classSession.findUnique({ where: { id } });
  }

  // detail with the nested class + lesson (incl. chapter title) the detail UI needs
  async getDetailById({ id }: { id: string }) {
    const row = await this.prisma.classSession.findUnique({
      where: { id },
      include: {
        class: {
          select: {
            id: true,
            name: true,
            code: true,
            subject: true,
            curriculumId: true,
            tutorId: true,
          },
        },
        lesson: { select: { id: true, title: true, chapter: { select: { title: true } } } },
      },
    });
    if (!row) return null;

    const { lesson, ...session } = row;
    return {
      ...session,
      lesson: lesson
        ? { id: lesson.id, title: lesson.title, chapterTitle: lesson.chapter?.title ?? null }
        : null,
    };
  }

  async isEnrolled({ userId, classId }: { userId: string; classId: string }) {
    const row = await this.prisma.classStudent.findFirst({
      where: { classId, studentId: userId },
      select: { id: true },
    });
    return !!row;
  }

  // a parent can reach a class when one of their children (users.parentId = userId) is enrolled
  async isParentOfEnrolled({ userId, classId }: { userId: string; classId: string }) {
    const row = await this.prisma.classStudent.findFirst({
      where: { classId, student: { parentId: userId } },
      select: { id: true },
    });
    return !!row;
  }

  async update({ id, data }: { id: string; data: UpdateSessionDto }) {
    try {
      return await this.prisma.classSession.update({
        where: { id },
        data: toSessionData(data as CreateSessionDto),
      });
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  async del({ id }: { id: string }) {
    const { count } = await this.prisma.classSession.deleteMany({ where: { id } });
    return count > 0;
  }
}
