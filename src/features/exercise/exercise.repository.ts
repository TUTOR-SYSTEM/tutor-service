import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
import type {
  CreateExerciseDto,
  ExerciseDetailDto,
  getExerciseDto,
} from '@packages/entities/exercise';
import { classes, exercise, sessions, users } from '@tutor/gateway/schema';

type ExerciseRow = typeof exercise.$inferSelect;

@Injectable()
export class ExerciseRepository {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: ReturnType<typeof drizzle>,
  ) {}

  // numeric columns come back from postgres as strings — expose score as a number for the API
  private map(row: ExerciseRow): ExerciseDetailDto {
    return {
      id: row.id,
      lessonId: row.lessonId,
      sessionId: row.sessionId,
      tutorId: row.tutorId,
      studentId: row.studentId,
      issueUrls: row.issueUrls ?? [],
      exerciseUrls: row.exerciseUrls ?? [],
      status: row.status,
      score: row.score !== null ? Number(row.score) : null,
      comment: row.comment,
      gradedAt: row.gradedAt ? row.gradedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async create({ data }: { data: CreateExerciseDto }): Promise<ExerciseDetailDto> {
    const [row] = await this.db
      .insert(exercise)
      .values({
        tutorId: data.tutorId,
        studentId: data.studentId,
        sessionId: data.sessionId ?? null,
        lessonId: data.lessonId ?? null,
        issueUrls: data.issueUrls ?? [],
        exerciseUrls: data.exerciseUrls ?? [],
        status: data.status ?? 'SUBMITTED',
      })
      .returning();
    return this.map(row);
  }

  // the existing submission of a student for a given session (one submission per session)
  async findByStudentSession({
    studentId,
    sessionId,
  }: {
    studentId: string;
    sessionId: string;
  }): Promise<ExerciseDetailDto | null> {
    const [row] = await this.db
      .select()
      .from(exercise)
      .where(and(eq(exercise.studentId, studentId), eq(exercise.sessionId, sessionId)))
      .limit(1);
    return row ? this.map(row) : null;
  }

  async findById({ id }: { id: string }): Promise<ExerciseDetailDto | null> {
    const [row] = await this.db.select().from(exercise).where(eq(exercise.id, id)).limit(1);
    return row ? this.map(row) : null;
  }

  // list exercises the acting user can reach (as the tutor or the student on the row),
  // narrowed by the optional query filters.
  async findAll({ userId, query }: { userId: string; query: getExerciseDto }) {
    const { page, limit, sessionId, studentId, classId, tutorId } = query;

    const accessWhere = or(eq(exercise.tutorId, userId), eq(exercise.studentId, userId));

    const conditions = [accessWhere];
    if (sessionId) conditions.push(eq(exercise.sessionId, sessionId));
    if (studentId) conditions.push(eq(exercise.studentId, studentId));
    if (tutorId) conditions.push(eq(exercise.tutorId, tutorId));
    if (classId) {
      const classSessionIds = this.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.classId, classId));
      conditions.push(inArray(exercise.sessionId, classSessionIds));
    }

    const whereClause = and(...conditions);

    const [totalRow] = await this.db.select({ total: count() }).from(exercise).where(whereClause);
    const total = Number(totalRow?.total ?? 0);
    const offset = (page - 1) * limit;

    // enrich each row with the session, its class, and the student — the grades dashboard
    // renders these relations, while the flat fields keep the detail/submit UIs working.
    const rows = await this.db
      .select({
        exercise,
        session: {
          id: sessions.id,
          sessionNumber: sessions.sessionNumber,
          classId: sessions.classId,
        },
        class: {
          id: classes.id,
          name: classes.name,
          code: classes.code,
        },
        student: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          userCode: users.userCode,
          avatar: users.avatar,
        },
      })
      .from(exercise)
      .leftJoin(sessions, eq(exercise.sessionId, sessions.id))
      .leftJoin(classes, eq(sessions.classId, classes.id))
      .leftJoin(users, eq(exercise.studentId, users.id))
      .where(whereClause)
      .orderBy(desc(exercise.updatedAt))
      .limit(limit)
      .offset(offset);

    return {
      data: rows.map((row) => ({
        ...this.map(row.exercise),
        session: row.session?.id ? row.session : null,
        class: row.class?.id ? row.class : null,
        student: row.student,
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async update({
    id,
    data,
  }: {
    id: string;
    data: Partial<{
      exerciseUrls: ExerciseRow['exerciseUrls'];
      status: ExerciseRow['status'];
      score: string | null;
      comment: string | null;
      gradedAt: Date | null;
    }>;
  }): Promise<ExerciseDetailDto | null> {
    const [row] = await this.db
      .update(exercise)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(exercise.id, id))
      .returning();
    return row ? this.map(row) : null;
  }
}
