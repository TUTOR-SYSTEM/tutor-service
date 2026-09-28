import { Inject, Injectable } from '@nestjs/common';
import { and, countDistinct, eq, gte, gt, inArray, lte, sql } from 'drizzle-orm';
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

@Injectable()
export class DashboardRepository {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: ReturnType<typeof drizzle>,
  ) {}

  /** Class ids owned by the tutor. */
  async getTutorClassIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: classes.id })
      .from(classes)
      .where(eq(classes.tutorId, userId));
    return rows.map((r) => r.id);
  }

  /** Class ids the student is enrolled in. */
  async getStudentClassIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: classStudents.classId })
      .from(classStudents)
      .where(eq(classStudents.studentId, userId));
    return rows.map((r) => r.id);
  }

  /** Distinct students enrolled across the given classes. */
  async countStudents(classIds: string[]): Promise<number> {
    if (classIds.length === 0) return 0;
    const [row] = await this.db
      .select({ total: countDistinct(classStudents.studentId) })
      .from(classStudents)
      .where(inArray(classStudents.classId, classIds));
    return Number(row?.total ?? 0);
  }

  /** Session counts (total + completed) within [from, to]. */
  async getSessionStats(
    classIds: string[],
    from: Date,
    to: Date,
  ): Promise<{ total: number; completed: number }> {
    if (classIds.length === 0) return { total: 0, completed: 0 };
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${sessions.status} = 'COMPLETED')::int`,
      })
      .from(sessions)
      .where(
        and(
          inArray(sessions.classId, classIds),
          gte(sessions.startAt, from),
          lte(sessions.startAt, to),
        ),
      );
    return { total: Number(row?.total ?? 0), completed: Number(row?.completed ?? 0) };
  }

  /** Sessions scheduled within [from, to], with class info, ordered by start time. */
  async getSchedule(classIds: string[], from: Date, to: Date): Promise<TodayScheduleRow[]> {
    if (classIds.length === 0) return [];
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
          inArray(sessions.classId, classIds),
          gte(sessions.startAt, from),
          lte(sessions.startAt, to),
        ),
      )
      .orderBy(sessions.startAt);

    return rows.map((r) => ({
      id: r.id,
      startAt: r.startAt instanceof Date ? r.startAt.toISOString() : String(r.startAt),
      endAt: r.endAt instanceof Date ? r.endAt.toISOString() : String(r.endAt),
      title: r.title,
      className: r.className,
      subject: r.subject,
      format: r.format,
      location: r.location,
    }));
  }

  /**
   * Session counts for today split by already-completed vs still pending.
   * "Pending" means the session is not yet finished (SCHEDULED / ONGOING).
   */
  async getSessionsToday(
    classIds: string[],
    from: Date,
    to: Date,
  ): Promise<{ completed: number; pending: number }> {
    if (classIds.length === 0) return { completed: 0, pending: 0 };
    const [row] = await this.db
      .select({
        completed: sql<number>`count(*) filter (where ${sessions.status} = 'COMPLETED')::int`,
        pending: sql<number>`count(*) filter (where ${sessions.status} != 'COMPLETED' and ${sessions.status} != 'CANCELLED')::int`,
      })
      .from(sessions)
      .where(
        and(
          inArray(sessions.classId, classIds),
          gte(sessions.startAt, from),
          lte(sessions.startAt, to),
        ),
      );
    return {
      completed: Number(row?.completed ?? 0),
      pending: Number(row?.pending ?? 0),
    };
  }

  /** Next `limit` upcoming sessions (start >= now, not finished), with class info. */
  async getUpcomingSchedule(
    classIds: string[],
    after: Date,
    limit: number,
  ): Promise<TodayScheduleRow[]> {
    if (classIds.length === 0) return [];
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
          inArray(sessions.classId, classIds),
          gt(sessions.startAt, after),
          sql`${sessions.status} != 'COMPLETED'`,
          sql`${sessions.status} != 'CANCELLED'`,
        ),
      )
      .orderBy(sessions.startAt)
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      startAt: r.startAt instanceof Date ? r.startAt.toISOString() : String(r.startAt),
      endAt: r.endAt instanceof Date ? r.endAt.toISOString() : String(r.endAt),
      title: r.title,
      className: r.className,
      subject: r.subject,
      format: r.format,
      location: r.location,
    }));
  }

  /** Per-month newly enrolled students (class_students.createdAt) for a year. */
  async getNewStudentsByMonth(classIds: string[], year: number): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (classIds.length === 0) return map;
    const rows = await this.db
      .select({
        month: sql<number>`extract(month from ${classStudents.createdAt})::int`,
        total: sql<number>`count(distinct ${classStudents.studentId})::int`,
      })
      .from(classStudents)
      .where(
        and(
          inArray(classStudents.classId, classIds),
          sql`extract(year from ${classStudents.createdAt}) = ${year}`,
        ),
      )
      .groupBy(sql`extract(month from ${classStudents.createdAt})`);
    for (const r of rows) map.set(Number(r.month), Number(r.total));
    return map;
  }

  /** Per-month newly created classes for a year. */
  async getNewClassesByMonth(classIds: string[], year: number): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (classIds.length === 0) return map;
    const rows = await this.db
      .select({
        month: sql<number>`extract(month from ${classes.createdAt})::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(classes)
      .where(
        and(inArray(classes.id, classIds), sql`extract(year from ${classes.createdAt}) = ${year}`),
      )
      .groupBy(sql`extract(month from ${classes.createdAt})`);
    for (const r of rows) map.set(Number(r.month), Number(r.total));
    return map;
  }

  /** Tuition revenue (PAID) within [from, to] for the given classes. */
  async getRevenue(classIds: string[], from: Date, to: Date): Promise<number> {
    if (classIds.length === 0) return 0;
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${tuitions.amount}), 0)` })
      .from(tuitions)
      .where(
        and(
          inArray(tuitions.classId, classIds),
          eq(tuitions.status, 'PAID'),
          gte(tuitions.paidDate, from),
          lte(tuitions.paidDate, to),
        ),
      );
    return Number(row?.total ?? 0);
  }

  /** Sum of tuition amounts in a given status for the given classes (optionally by student). */
  async getTuitionSum(
    classIds: string[],
    status: 'PAID' | 'UNPAID' | 'OVERDUE',
    studentId?: string,
  ): Promise<{ total: number; count: number }> {
    if (classIds.length === 0) return { total: 0, count: 0 };
    const conditions = [inArray(tuitions.classId, classIds), eq(tuitions.status, status)];
    if (studentId) conditions.push(eq(tuitions.studentId, studentId));
    const [row] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${tuitions.amount}), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(tuitions)
      .where(and(...conditions));
    return { total: Number(row?.total ?? 0), count: Number(row?.count ?? 0) };
  }

  /** Per-month PAID revenue for a year. */
  async getMonthlyRevenue(classIds: string[], year: number): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (classIds.length === 0) return map;
    const rows = await this.db
      .select({
        month: sql<number>`extract(month from ${tuitions.paidDate})::int`,
        total: sql<string>`coalesce(sum(${tuitions.amount}), 0)`,
      })
      .from(tuitions)
      .where(
        and(
          inArray(tuitions.classId, classIds),
          eq(tuitions.status, 'PAID'),
          sql`extract(year from ${tuitions.paidDate}) = ${year}`,
        ),
      )
      .groupBy(sql`extract(month from ${tuitions.paidDate})`);
    for (const r of rows) map.set(Number(r.month), Number(r.total));
    return map;
  }

  /** Per-month session counts for a year. */
  async getMonthlySessions(classIds: string[], year: number): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (classIds.length === 0) return map;
    const rows = await this.db
      .select({
        month: sql<number>`extract(month from ${sessions.startAt})::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(sessions)
      .where(
        and(
          inArray(sessions.classId, classIds),
          sql`extract(year from ${sessions.startAt}) = ${year}`,
        ),
      )
      .groupBy(sql`extract(month from ${sessions.startAt})`);
    for (const r of rows) map.set(Number(r.month), Number(r.total));
    return map;
  }
}
