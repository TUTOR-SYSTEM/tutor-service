import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

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

/** SQL fragment selecting class ids; embedded as the right side of `IN (...)`. */
export type ClassScope = Prisma.Sql;

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
const yearRange = (column: Prisma.Sql, year: number) =>
  Prisma.sql`${column} >= ${new Date(year, 0, 1)} AND ${column} < ${new Date(year + 1, 0, 1)}`;

const monthMap = (rows: { month: number; total: number }[]) =>
  new Map(rows.map((r) => [Number(r.month), Number(r.total)]));

// The dashboard is a set of aggregate reports scoped by a class-id subquery, so it stays on
// parameterised raw SQL (every interpolation below is a bound parameter, never string-built).
@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Subquery of class ids owned by the tutor (embedded in `IN (...)`, no id round trip). */
  tutorClassScope(userId: string): ClassScope {
    return Prisma.sql`SELECT id FROM classes WHERE tutor_id = ${userId}::uuid`;
  }

  /** Subquery of class ids the student is enrolled in. */
  studentClassScope(userId: string): ClassScope {
    return Prisma.sql`SELECT class_id FROM class_students WHERE student_id = ${userId}::uuid`;
  }

  async countClasses(scope: ClassScope): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS total FROM classes WHERE id IN (${scope})`;
    return Number(row?.total ?? 0);
  }

  /** Distinct students enrolled across the given classes. */
  async countStudents(scope: ClassScope): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ total: number }[]>`
      SELECT count(DISTINCT student_id)::int AS total
      FROM class_students WHERE class_id IN (${scope})`;
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
    const today = Prisma.sql`start_at >= ${day.from} AND start_at <= ${day.to}`;
    const [row] = await this.prisma.$queryRaw<
      {
        total: number;
        completed: number;
        todayCompleted: number;
        todayPending: number;
      }[]
    >`
      SELECT
        count(*)::int AS "total",
        (count(*) FILTER (WHERE status = 'COMPLETED'))::int AS "completed",
        (count(*) FILTER (WHERE status = 'COMPLETED' AND ${today}))::int AS "todayCompleted",
        (count(*) FILTER (WHERE status NOT IN ('COMPLETED', 'CANCELLED') AND ${today}))::int AS "todayPending"
      FROM class_sessions
      WHERE class_id IN (${scope}) AND start_at >= ${week.from} AND start_at <= ${week.to}`;
    return {
      total: Number(row?.total ?? 0),
      completed: Number(row?.completed ?? 0),
      todayCompleted: Number(row?.todayCompleted ?? 0),
      todayPending: Number(row?.todayPending ?? 0),
    };
  }

  /** Sessions scheduled within [from, to], with class info, ordered by start time. */
  async getSchedule(scope: ClassScope, from: Date, to: Date): Promise<TodayScheduleRow[]> {
    const rows = await this.prisma.$queryRaw<RawScheduleRow[]>`
      SELECT s.id, s.start_at AS "startAt", s.end_at AS "endAt", s.title, s.location,
             c.name AS "className", c.subject, c.format::text AS format
      FROM class_sessions s
      INNER JOIN classes c ON c.id = s.class_id
      WHERE s.class_id IN (${scope}) AND s.start_at >= ${from} AND s.start_at <= ${to}
      ORDER BY s.start_at`;
    return rows.map(toScheduleRow);
  }

  /** Next `limit` upcoming sessions (start >= now, not finished), with class info. */
  async getUpcomingSchedule(
    scope: ClassScope,
    after: Date,
    limit: number,
  ): Promise<TodayScheduleRow[]> {
    const rows = await this.prisma.$queryRaw<RawScheduleRow[]>`
      SELECT s.id, s.start_at AS "startAt", s.end_at AS "endAt", s.title, s.location,
             c.name AS "className", c.subject, c.format::text AS format
      FROM class_sessions s
      INNER JOIN classes c ON c.id = s.class_id
      WHERE s.class_id IN (${scope}) AND s.start_at > ${after}
        AND s.status != 'COMPLETED' AND s.status != 'CANCELLED'
      ORDER BY s.start_at
      LIMIT ${limit}`;
    return rows.map(toScheduleRow);
  }

  /** Per-month newly enrolled students (class_students.createdAt) for a year. */
  async getNewStudentsByMonth(scope: ClassScope, year: number): Promise<Map<number, number>> {
    const rows = await this.prisma.$queryRaw<{ month: number; total: number }[]>`
      SELECT extract(month FROM created_at)::int AS month,
             count(DISTINCT student_id)::int AS total
      FROM class_students
      WHERE class_id IN (${scope}) AND ${yearRange(Prisma.sql`created_at`, year)}
      GROUP BY extract(month FROM created_at)`;
    return monthMap(rows);
  }

  /** Per-month newly created classes for a year. */
  async getNewClassesByMonth(scope: ClassScope, year: number): Promise<Map<number, number>> {
    const rows = await this.prisma.$queryRaw<{ month: number; total: number }[]>`
      SELECT extract(month FROM created_at)::int AS month, count(*)::int AS total
      FROM classes
      WHERE id IN (${scope}) AND ${yearRange(Prisma.sql`created_at`, year)}
      GROUP BY extract(month FROM created_at)`;
    return monthMap(rows);
  }

  /** Tuition revenue (PAID) within [from, to] for the given classes. */
  async getRevenue(scope: ClassScope, from: Date, to: Date): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ total: number }[]>`
      SELECT coalesce(sum(amount), 0)::float8 AS total
      FROM tuitions
      WHERE class_id IN (${scope}) AND status = 'PAID'
        AND paid_date >= ${from} AND paid_date <= ${to}`;
    return Number(row?.total ?? 0);
  }

  /** OVERDUE + UNPAID tuition totals in one grouped query (optionally for one student). */
  async getTuitionSums(
    scope: ClassScope,
    studentId?: string,
  ): Promise<Record<'OVERDUE' | 'UNPAID', { total: number; count: number }>> {
    const studentFilter = studentId
      ? Prisma.sql`AND student_id = ${studentId}::uuid`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ status: string; total: number; count: number }[]>`
      SELECT status::text AS status, coalesce(sum(amount), 0)::float8 AS total, count(*)::int AS count
      FROM tuitions
      WHERE class_id IN (${scope}) AND status IN ('OVERDUE', 'UNPAID') ${studentFilter}
      GROUP BY status`;
    const out = { OVERDUE: { total: 0, count: 0 }, UNPAID: { total: 0, count: 0 } };
    for (const r of rows) {
      if (r.status === 'OVERDUE' || r.status === 'UNPAID')
        out[r.status] = { total: Number(r.total), count: Number(r.count) };
    }
    return out;
  }

  /** Per-month PAID revenue for a year. */
  async getMonthlyRevenue(scope: ClassScope, year: number): Promise<Map<number, number>> {
    const rows = await this.prisma.$queryRaw<{ month: number; total: number }[]>`
      SELECT extract(month FROM paid_date)::int AS month,
             coalesce(sum(amount), 0)::float8 AS total
      FROM tuitions
      WHERE class_id IN (${scope}) AND status = 'PAID' AND ${yearRange(Prisma.sql`paid_date`, year)}
      GROUP BY extract(month FROM paid_date)`;
    return monthMap(rows);
  }

  /** Per-month session counts for a year. */
  async getMonthlySessions(scope: ClassScope, year: number): Promise<Map<number, number>> {
    const rows = await this.prisma.$queryRaw<{ month: number; total: number }[]>`
      SELECT extract(month FROM start_at)::int AS month, count(*)::int AS total
      FROM class_sessions
      WHERE class_id IN (${scope}) AND ${yearRange(Prisma.sql`start_at`, year)}
      GROUP BY extract(month FROM start_at)`;
    return monthMap(rows);
  }
}
