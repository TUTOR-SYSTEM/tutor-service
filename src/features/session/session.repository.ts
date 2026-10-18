import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, lte, ne, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
import {
  CreateSessionDto,
  CreateSessionsDto,
  GetSessionsQueryDto,
  UpdateSessionDto,
} from '@packages/entities/session';
import { chapters, classStudents, classes, lessons, sessions, users } from 'src/database/schema';
import { buildListWhereClause } from '@packages/helpers';
import { toDate } from '@packages/helpers/date.helper';

@Injectable()
export class SessionRepository {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: ReturnType<typeof drizzle>,
  ) {}

  async create({ data }: { data: CreateSessionDto }) {
    const [session] = await this.db
      .insert(sessions)
      .values({
        classId: data.classId,
        lessonId: data.lessonId,
        tutorId: data.tutorId,
        title: data.title,
        description: data.description,
        sessionNumber: data.sessionNumber,
        theoryUrls: data.theoryUrls,
        exerciseUrls: data.exerciseUrls,
        startAt: toDate(data.startAt),
        endAt: toDate(data.endAt),
        location: data.location,
        status: data.status,
        note: data.note,
        actualStartAt: toDate(data.actualStartAt),
        actualEndAt: toDate(data.actualEndAt),
        objectives: data.objectives,
        agenda: data.agenda,
        exerciseDueAt: toDate(data.exerciseDueAt),
      })
      .returning();
    return session;
  }

  async createMany({ classId, items }: { classId: string; items: CreateSessionsDto['sessions'] }) {
    const rows = await this.db
      .insert(sessions)
      .values(
        items.map((item) => ({
          classId,
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
        })),
      )
      .returning();
    return rows;
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
      searchableColumns: { title: { column: sessions.title } },
      filters: { status, classId },
      filterColumns: {
        status: { column: sessions.status },
        classId: { column: sessions.classId },
      },
    });

    // ADMIN sees every session; everyone else sees owned or enrolled classes only
    const accessWhere =
      role === 'ADMIN'
        ? undefined
        : or(inArray(sessions.classId, ownedClassIds), inArray(sessions.classId, enrolledClassIds));
    // Dates arrive as ISO strings after the RPC JSON round trip; drizzle's `timestamp` columns
    // call `toISOString()` on the bound value, so convert first (same rule as the write paths).
    const from = toDate(startDate);
    const to = toDate(endDate);
    const dateWhere = and(
      ...(from ? [gte(sessions.startAt, from)] : []),
      ...(to ? [lte(sessions.startAt, to)] : []),
    );
    const whereClause = and(
      ...[searchWhere, accessWhere, dateWhere].filter((c) => c !== undefined),
    );

    const [totalRow] = await this.db.select({ total: count() }).from(sessions).where(whereClause);
    const total = Number(totalRow?.total ?? 0);
    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    const offset = (pageNumber - 1) * limitNumber;

    const rows = await this.db
      .select({
        session: sessions,
        class: {
          id: classes.id,
          name: classes.name,
          code: classes.code,
          subject: classes.subject,
          tutorId: classes.tutorId,
        },
      })
      .from(sessions)
      .leftJoin(classes, eq(sessions.classId, classes.id))
      .where(whereClause)
      .orderBy(desc(sessions.startAt), sessions.id)
      .limit(limitNumber)
      .offset(offset);

    return {
      sessions: rows.map((row) => ({ ...row.session, class: row.class })),
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
      .from(sessions)
      .where(eq(sessions.classId, classId))
      .orderBy(asc(sessions.sessionNumber), asc(sessions.startAt));
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
    const [session] = await this.db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    return session;
  }

  // detail with the nested class + lesson (incl. chapter title) the detail UI needs
  async getDetailById({ id }: { id: string }) {
    const [row] = await this.db
      .select({
        session: sessions,
        class: {
          id: classes.id,
          name: classes.name,
          code: classes.code,
          subject: classes.subject,
          curriculumId: classes.curriculumId,
          tutorId: classes.tutorId,
        },
        lesson: {
          id: lessons.id,
          title: lessons.title,
          chapterTitle: chapters.title,
        },
      })
      .from(sessions)
      .leftJoin(classes, eq(sessions.classId, classes.id))
      .leftJoin(lessons, eq(sessions.lessonId, lessons.id))
      .leftJoin(chapters, eq(lessons.chapterId, chapters.id))
      .leftJoin(users, eq(users.id, classes.tutorId))
      .where(eq(sessions.id, id))
      .limit(1);

    if (!row) return null;
    return {
      ...row.session,
      class: row.class,
      lesson: row.lesson?.id ? row.lesson : null,
    };
  }

  async isEnrolled({ userId, classId }: { userId: string; classId: string }) {
    const [row] = await this.db
      .select({ id: classStudents.id })
      .from(classStudents)
      .where(and(eq(classStudents.classId, classId), eq(classStudents.studentId, userId)))
      .limit(1);
    return !!row;
  }

  // a parent can reach a class when one of their children (users.parentId = userId) is enrolled
  async isParentOfEnrolled({ userId, classId }: { userId: string; classId: string }) {
    const [row] = await this.db
      .select({ id: classStudents.id })
      .from(classStudents)
      .innerJoin(users, eq(users.id, classStudents.studentId))
      .where(and(eq(classStudents.classId, classId), eq(users.parentId, userId)))
      .limit(1);
    return !!row;
  }

  async update({ id, data }: { id: string; data: UpdateSessionDto }) {
    const [session] = await this.db
      .update(sessions)
      .set({
        lessonId: data.lessonId,
        tutorId: data.tutorId,
        title: data.title,
        description: data.description,
        sessionNumber: data.sessionNumber,
        theoryUrls: data.theoryUrls,
        exerciseUrls: data.exerciseUrls,
        startAt: toDate(data.startAt),
        endAt: toDate(data.endAt),
        location: data.location,
        status: data.status,
        note: data.note,
        actualStartAt: toDate(data.actualStartAt),
        actualEndAt: toDate(data.actualEndAt),
        objectives: data.objectives,
        agenda: data.agenda,
        exerciseDueAt: toDate(data.exerciseDueAt),
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, id))
      .returning();
    return session;
  }

  async del({ id }: { id: string }) {
    const [session] = await this.db.delete(sessions).where(eq(sessions.id, id)).returning();
    return !!session;
  }
}
