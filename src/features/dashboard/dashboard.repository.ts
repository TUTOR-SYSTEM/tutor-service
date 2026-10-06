import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  countDistinct,
  eq,
  gte,
  gt,
  inArray,
  lt,
  lte,
  sql,
  type AnyColumn,
  type SQLWrapper,
} from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
import { classStudents, classes, sessions, tuitions } from '@tutor/gateway/schema';

export interface TodayScheduleRow {
  id: string;
  startAt: string;
  endAt: string;
  title: string | null;
  className: string;
  subject: string;
  format: string;
  location: string | null;
}

export interface MonthlyRow {
  month: number; // 1..12
  revenue: number;
  sessions: number;
  newStudents: number;
  newClasses: number;
  cumulativeRevenue: number;
}

/** Drizzle subquery selecting class ids; usable as the right side of `inArray`. */
export type ClassScope = SQLWrapper;

type RawScheduleRow = Omit<TodayScheduleRow, 'startAt' | 'endAt'> & {
  startAt: Date | string;
  endAt: Date | string;
};

const toIso = (v: Date | string) => (v instanceof Date ? v.toISOString() : String(v));

const toScheduleRow = (r: RawScheduleRow): TodayScheduleRow => ({
  id: r.id,
  startAt: toIso(r.startAt),
  endAt: toIso(r.endAt),
  title: r.title,
  className: r.className,
  subject: r.subject,
  format: r.format,
  location: r.location,
});

/** [Jan 1, next Jan 1) bounds on a column — lets Postgres use an index, unlike extract(year). */
const yearRange = (column: AnyColumn, year: number) => [
  gte(column, new Date(year, 0, 1)),
  lt(column, new Date(year + 1, 0, 1)),
];

@Injectable()
export class DashboardRepository {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: ReturnType<typeof drizzle>,
  ) {}

  /** Subquery of class ids owned by the tutor (embedded in `IN (...)`, no id round trip). */
  tutorClassScope(userId: string): ClassScope {
    return this.db.select({ id: classes.id }).from(classes).where(eq(classes.tutorId, userId));
  }

  /** Subquery of class ids the student is enrolled in. */
  studentClassScope(userId: string): ClassScope {
    return this.db
      .select({ id: classStudents.classId })
      .from(classStudents)
      .where(eq(classStudents.studentId, userId));
  }

  async countClasses(scope: ClassScope): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(classes)
      .where(inArray(classes.id, scope));
    return Number(row?.total ?? 0);
  }

  /** Distinct students enrolled across the given classes. */
  async countStudents(scope: ClassScope): Promise<number> {
    const [row] = await this.db
      .select({ total: countDistinct(classStudents.studentId) })
      .from(classStudents)
      .where(inArray(classStudents.classId, scope));
    return Number(row?.total ?? 0);
  }

  /**
   * One scan over the week window: week totals plus today's completed/pending split
   * ("pending" = not finished and not cancelled).
   */
  async getSessionStats(
    scope: ClassScope,
    week: { from: Date; to: Date },
    day: { from: Date; to: Date },
  ): Promise<{ total: number; completed: number; todayCompleted: number; todayPending: number }> {
    const today = and(gte(sessions.startAt, day.from), lte(sessions.startAt, day.to));
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${sessions.status} = 'COMPLETED')::int`,
        todayCompleted: sql<number>`count(*) filter (where ${sessions.status} = 'COMPLETED' and ${today})::int`,
        todayPending: sql<number>`count(*) filter (where ${sessions.status} not in ('COMPLETED', 'CANCELLED') and ${today})::int`,
      })
      .from(sessions)
      .where(
        and(
          inArray(sessions.classId, scope),
          gte(sessions.startAt, week.from),
          lte(sessions.startAt, week.to),
        ),
      );
    return {
      total: Number(row?.total ?? 0),
      completed: Number(row?.completed ?? 0),
      todayCompleted: Number(row?.todayCompleted ?? 0),
      todayPending: Number(row?.todayPending ?? 0),
    };
  }

  /** Sessions scheduled within [from, to], with class info, ordered by start time. */
  async getSchedule(scope: ClassScope, from: Date, to: Date): Promise<TodayScheduleRow[]> {
    const rows = await this.db
      .select({
        id: sessions.id,
        startAt: sessions.startAt,
        endAt: sessions.endAt,
        title: sessions.title,
        location: sessions.location,
        className: classes.name,
        subject: classes.subject,
        format: classes.format,
      })
      .from(sessions)
      .innerJoin(classes, eq(classes.id, sessions.classId))
      .where(
        and(
          inArray(sessions.classId, scope),
          gte(sessions.startAt, from),
          lte(sessions.startAt, to),
        ),
      )
      .orderBy(sessions.startAt);

    return rows.map(toScheduleRow);
  }

  /** Next `limit` upcoming sessions (start >= now, not finished), with class info. */
  async getUpcomingSchedule(
    scope: ClassScope,
    after: Date,
    limit: number,
  ): Promise<TodayScheduleRow[]> {
    const rows = await this.db
      .select({
        id: sessions.id,
        startAt: sessions.startAt,
        endAt: sessions.endAt,
        title: sessions.title,
        location: sessions.location,
        className: classes.name,
        subject: classes.subject,
        format: classes.format,
      })
      .from(sessions)
      .innerJoin(classes, eq(classes.id, sessions.classId))
      .where(
        and(
          inArray(sessions.classId, scope),
          gt(sessions.startAt, after),
          sql`${sessions.status} != 'COMPLETED'`,
          sql`${sessions.status} != 'CANCELLED'`,
        ),
      )
      .orderBy(sessions.startAt)
      .limit(limit);

    return rows.map(toScheduleRow);
  }

  /** Per-month newly enrolled students (class_students.createdAt) for a year. */
  async getNewStudentsByMonth(scope: ClassScope, year: number): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    const rows = await this.db
      .select({
        month: sql<number>`extract(month from ${classStudents.createdAt})::int`,
        total: sql<number>`count(distinct ${classStudents.studentId})::int`,
      })
      .from(classStudents)
      .where(
        and(inArray(classStudents.classId, scope), ...yearRange(classStudents.createdAt, year)),
      )
      .groupBy(sql`extract(month from ${classStudents.createdAt})`);
    for (const r of rows) map.set(Number(r.month), Number(r.total));
    return map;
  }

  /** Per-month newly created classes for a year. */
  async getNewClassesByMonth(scope: ClassScope, year: number): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    const rows = await this.db
      .select({
        month: sql<number>`extract(month from ${classes.createdAt})::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(classes)
      .where(and(inArray(classes.id, scope), ...yearRange(classes.createdAt, year)))
      .groupBy(sql`extract(month from ${classes.createdAt})`);
    for (const r of rows) map.set(Number(r.month), Number(r.total));
    return map;
  }

  /** Tuition revenue (PAID) within [from, to] for the given classes. */
  async getRevenue(scope: ClassScope, from: Date, to: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${tuitions.amount}), 0)` })
      .from(tuitions)
      .where(
        and(
          inArray(tuitions.classId, scope),
          eq(tuitions.status, 'PAID'),
          gte(tuitions.paidDate, from),
          lte(tuitions.paidDate, to),
        ),
      );
    return Number(row?.total ?? 0);
  }

  /** OVERDUE + UNPAID tuition totals in one grouped query (optionally for one student). */
  async getTuitionSums(
    scope: ClassScope,
    studentId?: string,
  ): Promise<Record<'OVERDUE' | 'UNPAID', { total: number; count: number }>> {
    const conditions = [
      inArray(tuitions.classId, scope),
      inArray(tuitions.status, ['OVERDUE', 'UNPAID']),
    ];
    if (studentId) conditions.push(eq(tuitions.studentId, studentId));
    const rows = await this.db
      .select({
        status: tuitions.status,
        total: sql<string>`coalesce(sum(${tuitions.amount}), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(tuitions)
      .where(and(...conditions))
      .groupBy(tuitions.status);
    const out = { OVERDUE: { total: 0, count: 0 }, UNPAID: { total: 0, count: 0 } };
    for (const r of rows) {
      if (r.status === 'OVERDUE' || r.status === 'UNPAID')
        out[r.status] = { total: Number(r.total), count: Number(r.count) };
    }
    return out;
  }

  /** Per-month PAID revenue for a year. */
  async getMonthlyRevenue(scope: ClassScope, year: number): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    const rows = await this.db
      .select({
        month: sql<number>`extract(month from ${tuitions.paidDate})::int`,
        total: sql<string>`coalesce(sum(${tuitions.amount}), 0)`,
      })
      .from(tuitions)
      .where(
        and(
          inArray(tuitions.classId, scope),
          eq(tuitions.status, 'PAID'),
          ...yearRange(tuitions.paidDate, year),
        ),
      )
      .groupBy(sql`extract(month from ${tuitions.paidDate})`);
    for (const r of rows) map.set(Number(r.month), Number(r.total));
    return map;
  }

  /** Per-month session counts for a year. */
  async getMonthlySessions(scope: ClassScope, year: number): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    const rows = await this.db
      .select({
        month: sql<number>`extract(month from ${sessions.startAt})::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(sessions)
      .where(and(inArray(sessions.classId, scope), ...yearRange(sessions.startAt, year)))
      .groupBy(sql`extract(month from ${sessions.startAt})`);
    for (const r of rows) map.set(Number(r.month), Number(r.total));
    return map;
  }
}
