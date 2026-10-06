import { Inject, Injectable } from '@nestjs/common';
import { and, count, countDistinct, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
import { classes, classStudents, exercise, lessons, sessions, users } from 'src/database/schema';
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

@Injectable()
export class ReportRepository {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: ReturnType<typeof drizzle>,
  ) {}

  async countActiveClasses(): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(classes)
      .where(eq(classes.status, 'OPEN'));
    return Number(row?.total ?? 0);
  }

  async getAllClassIds(): Promise<string[]> {
    const rows = await this.db.select({ id: classes.id }).from(classes);
    return rows.map((r) => r.id);
  }

  /** Global session attendance proxy: COMPLETED / (COMPLETED + CANCELLED), optionally bounded by [from, to]. */
  async getSessionAttendance(
    from?: Date,
    to?: Date,
  ): Promise<{ completed: number; resolved: number }> {
    const conditions: SQL[] = [];
    if (from) conditions.push(gte(sessions.startAt, from));
    if (to) conditions.push(lte(sessions.startAt, to));

    const [row] = await this.db
      .select({
        completed: sql<number>`count(*) filter (where ${sessions.status} = 'COMPLETED')::int`,
        resolved: sql<number>`count(*) filter (where ${sessions.status} in ('COMPLETED', 'CANCELLED'))::int`,
      })
      .from(sessions)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return { completed: Number(row?.completed ?? 0), resolved: Number(row?.resolved ?? 0) };
  }

  /** Per-month session attendance for the given month buckets (each [from, to)). */
  async getMonthlySessionAttendance(
    buckets: { from: Date; to: Date }[],
  ): Promise<{ completed: number; resolved: number }[]> {
    return Promise.all(buckets.map((b) => this.getSessionAttendance(b.from, b.to)));
  }

  /** Overall exercise submission rate across every exercise row. */
  async getGlobalSubmissionStats(): Promise<{ submitted: number; total: number }> {
    const [row] = await this.db
      .select({
        submitted: sql<number>`count(*) filter (where ${exercise.status} <> 'RESUBMIT')::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(exercise);
    return { submitted: Number(row?.submitted ?? 0), total: Number(row?.total ?? 0) };
  }

  async getClassesTotal(search?: string): Promise<number> {
    const whereClause = buildListWhereClause({
      search,
      searchableColumns: {
        name: { column: classes.name },
        code: { column: classes.code },
        subject: { column: classes.subject },
      },
    });
    const [row] = await this.db.select({ total: count() }).from(classes).where(whereClause);
    return Number(row?.total ?? 0);
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
    const whereClause = buildListWhereClause({
      search,
      searchableColumns: {
        name: { column: classes.name },
        code: { column: classes.code },
        subject: { column: classes.subject },
      },
    });

    return this.db
      .select({
        id: classes.id,
        name: classes.name,
        curriculumId: classes.curriculumId,
        tutorFirstName: users.firstName,
        tutorLastName: users.lastName,
      })
      .from(classes)
      .leftJoin(users, eq(users.id, classes.tutorId))
      .where(whereClause)
      .orderBy(classes.createdAt)
      .limit(limit)
      .offset(offset);
  }

  /** Per-class aggregates (attendance, curriculum progress, assignments, average score) for the given class ids. */
  async getClassAggregates(classIds: string[]): Promise<Map<string, ClassAggregate>> {
    const result = new Map<string, ClassAggregate>();
    if (classIds.length === 0) return result;

    const [studentCounts, sessionAgg, doneLessons, classCurricula, exerciseAgg] = await Promise.all(
      [
        this.db
          .select({ classId: classStudents.classId, total: count() })
          .from(classStudents)
          .where(inArray(classStudents.classId, classIds))
          .groupBy(classStudents.classId),
        this.db
          .select({
            classId: sessions.classId,
            completed: sql<number>`count(*) filter (where ${sessions.status} = 'COMPLETED')::int`,
            resolved: sql<number>`count(*) filter (where ${sessions.status} in ('COMPLETED', 'CANCELLED'))::int`,
          })
          .from(sessions)
          .where(inArray(sessions.classId, classIds))
          .groupBy(sessions.classId),
        this.db
          .select({
            classId: sessions.classId,
            doneLessons: countDistinct(sessions.lessonId),
          })
          .from(sessions)
          .where(and(inArray(sessions.classId, classIds), eq(sessions.status, 'COMPLETED')))
          .groupBy(sessions.classId),
        this.db
          .select({ id: classes.id, curriculumId: classes.curriculumId })
          .from(classes)
          .where(inArray(classes.id, classIds)),
        this.db
          .select({
            classId: sessions.classId,
            total: sql<number>`count(*)::int`,
            submitted: sql<number>`count(*) filter (where ${exercise.status} <> 'RESUBMIT')::int`,
            averageScore: sql<string | null>`avg(${exercise.score})`,
          })
          .from(exercise)
          .innerJoin(sessions, eq(exercise.sessionId, sessions.id))
          .where(inArray(sessions.classId, classIds))
          .groupBy(sessions.classId),
      ],
    );

    const curriculumIds = [
      ...new Set(classCurricula.map((c) => c.curriculumId).filter((id): id is string => !!id)),
    ];
    const lessonTotals =
      curriculumIds.length > 0
        ? await this.db
            .select({ curriculumId: lessons.curriculumId, total: count() })
            .from(lessons)
            .where(inArray(lessons.curriculumId, curriculumIds))
            .groupBy(lessons.curriculumId)
        : [];

    const lessonTotalMap = new Map(lessonTotals.map((l) => [l.curriculumId, Number(l.total)]));
    const curriculumByClass = new Map(classCurricula.map((c) => [c.id, c.curriculumId]));
    const studentCountMap = new Map(studentCounts.map((s) => [s.classId, Number(s.total)]));
    const sessionAggMap = new Map(sessionAgg.map((s) => [s.classId, s]));
    const doneLessonsMap = new Map(doneLessons.map((d) => [d.classId, Number(d.doneLessons)]));
    const exerciseAggMap = new Map(exerciseAgg.map((e) => [e.classId, e]));

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
