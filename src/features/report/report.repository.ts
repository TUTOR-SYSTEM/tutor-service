import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, uuidList } from '../../database/prisma.service';
import { buildListWhereClause } from '@packages/helpers';

export interface ClassAggregate {
  studentCount: number;
  attendanceRate: number;
  curriculumProgress: number;
  assignmentsSubmitted: number;
  assignmentsTotal: number;
  averageScore: number | null;
}

export interface ClassBaseRow {
  id: string;
  name: string;
  curriculumId: string | null;
  tutorFirstName: string | null;
  tutorLastName: string | null;
}

const CLASS_SEARCH_FIELDS = ['name', 'code', 'subject'] as const;

@Injectable()
export class ReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countActiveClasses(): Promise<number> {
    return this.prisma.class.count({ where: { status: 'OPEN' } });
  }

  async getAllClassIds(): Promise<string[]> {
    const rows = await this.prisma.class.findMany({ select: { id: true } });
    return rows.map((r) => r.id);
  }

  /** Global session attendance proxy: COMPLETED / (COMPLETED + CANCELLED), optionally bounded by [from, to]. */
  async getSessionAttendance(
    from?: Date,
    to?: Date,
  ): Promise<{ completed: number; resolved: number }> {
    const startAt: Prisma.DateTimeFilter = { ...(from && { gte: from }), ...(to && { lte: to }) };
    const [completed, cancelled] = await Promise.all([
      this.prisma.classSession.count({ where: { startAt, status: 'COMPLETED' } }),
      this.prisma.classSession.count({ where: { startAt, status: 'CANCELLED' } }),
    ]);
    return { completed, resolved: completed + cancelled };
  }

  /** Per-month session attendance for the given month buckets (each [from, to)). */
  async getMonthlySessionAttendance(
    buckets: { from: Date; to: Date }[],
  ): Promise<{ completed: number; resolved: number }[]> {
    return Promise.all(buckets.map((b) => this.getSessionAttendance(b.from, b.to)));
  }

  /** Overall exercise submission rate across every exercise row. */
  async getGlobalSubmissionStats(): Promise<{ submitted: number; total: number }> {
    const [total, resubmit] = await Promise.all([
      this.prisma.exercise.count(),
      this.prisma.exercise.count({ where: { status: 'RESUBMIT' } }),
    ]);
    return { submitted: total - resubmit, total };
  }

  async getClassesTotal(search?: string): Promise<number> {
    const where = buildListWhereClause({ search, searchFields: CLASS_SEARCH_FIELDS });
    return this.prisma.class.count({ where: where as Prisma.ClassWhereInput | undefined });
  }

  async getClassesPage({
    search,
    limit,
    offset,
  }: {
    search?: string;
    limit: number;
    offset: number;
  }): Promise<ClassBaseRow[]> {
    const where = buildListWhereClause({ search, searchFields: CLASS_SEARCH_FIELDS });

    const rows = await this.prisma.class.findMany({
      where: where as Prisma.ClassWhereInput | undefined,
      select: {
        id: true,
        name: true,
        curriculumId: true,
        tutor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      skip: offset,
    });

    return rows.map(({ tutor, ...row }) => ({
      ...row,
      tutorFirstName: tutor?.firstName ?? null,
      tutorLastName: tutor?.lastName ?? null,
    }));
  }

  /** Per-class aggregates (attendance, curriculum progress, assignments, average score) for the given class ids. */
  async getClassAggregates(classIds: string[]): Promise<Map<string, ClassAggregate>> {
    const result = new Map<string, ClassAggregate>();
    if (classIds.length === 0) return result;

    const [studentCounts, sessionAgg, doneLessonRows, classCurricula, exerciseAgg] =
      await Promise.all([
        this.prisma.classStudent.groupBy({
          by: ['classId'],
          where: { classId: { in: classIds } },
          _count: { _all: true },
        }),
        this.prisma.classSession.groupBy({
          by: ['classId', 'status'],
          where: { classId: { in: classIds } },
          _count: { _all: true },
        }),
        // distinct (class, lesson) pairs of completed sessions — nulls are not lessons
        this.prisma.classSession.findMany({
          where: { classId: { in: classIds }, status: 'COMPLETED', lessonId: { not: null } },
          select: { classId: true, lessonId: true },
          distinct: ['classId', 'lessonId'],
        }),
        this.prisma.class.findMany({
          where: { id: { in: classIds } },
          select: { id: true, curriculumId: true },
        }),
        this.prisma.$queryRaw<
          {
            classId: string;
            total: number;
            submitted: number;
            averageScore: Prisma.Decimal | null;
          }[]
        >`
          SELECT s.class_id AS "classId",
                 count(*)::int AS total,
                 (count(*) FILTER (WHERE e.status <> 'RESUBMIT'))::int AS submitted,
                 avg(e.score) AS "averageScore"
          FROM exercises e
          INNER JOIN class_sessions s ON e.session_id = s.id
          WHERE s.class_id IN (${uuidList(classIds)})
          GROUP BY s.class_id`,
      ]);

    const curriculumIds = [
      ...new Set(classCurricula.map((c) => c.curriculumId).filter((id): id is string => !!id)),
    ];
    const lessonTotals =
      curriculumIds.length > 0
        ? await this.prisma.lesson.groupBy({
            by: ['curriculumId'],
            where: { curriculumId: { in: curriculumIds } },
            _count: { _all: true },
          })
        : [];

    const lessonTotalMap = new Map(lessonTotals.map((l) => [l.curriculumId, l._count._all]));
    const curriculumByClass = new Map(classCurricula.map((c) => [c.id, c.curriculumId]));
    const studentCountMap = new Map(studentCounts.map((s) => [s.classId, s._count._all]));
    const exerciseAggMap = new Map(exerciseAgg.map((e) => [e.classId, e]));

    const sessionAggMap = new Map<string, { completed: number; resolved: number }>();
    for (const row of sessionAgg) {
      const agg = sessionAggMap.get(row.classId) ?? { completed: 0, resolved: 0 };
      if (row.status === 'COMPLETED') agg.completed += row._count._all;
      if (row.status === 'COMPLETED' || row.status === 'CANCELLED') agg.resolved += row._count._all;
      sessionAggMap.set(row.classId, agg);
    }

    const doneLessonsMap = new Map<string, number>();
    for (const row of doneLessonRows) {
      doneLessonsMap.set(row.classId, (doneLessonsMap.get(row.classId) ?? 0) + 1);
    }

    for (const classId of classIds) {
      const session = sessionAggMap.get(classId);
      const attendanceRate =
        session && session.resolved > 0
          ? Math.round((session.completed / session.resolved) * 100)
          : 0;

      const curriculumId = curriculumByClass.get(classId) ?? null;
      const lessonTotal = curriculumId ? (lessonTotalMap.get(curriculumId) ?? 0) : 0;
      const doneLessonCount = doneLessonsMap.get(classId) ?? 0;
      const curriculumProgress =
        curriculumId && lessonTotal > 0 ? Math.round((doneLessonCount / lessonTotal) * 100) : 0;

      const exerciseRow = exerciseAggMap.get(classId);
      const averageScore =
        exerciseRow?.averageScore != null
          ? Math.round(Number(exerciseRow.averageScore) * 10) / 10
          : null;

      result.set(classId, {
        studentCount: studentCountMap.get(classId) ?? 0,
        attendanceRate,
        curriculumProgress,
        assignmentsSubmitted: exerciseRow ? Number(exerciseRow.submitted) : 0,
        assignmentsTotal: exerciseRow ? Number(exerciseRow.total) : 0,
        averageScore,
      });
    }

    return result;
  }
}
