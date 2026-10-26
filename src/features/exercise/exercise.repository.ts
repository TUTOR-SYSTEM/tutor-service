import { Injectable } from '@nestjs/common';
import { Exercise, ExerciseStatus, Prisma } from '@prisma/client';
import { PrismaService, isRecordNotFound } from '../../database/prisma.service';
import type {
  CreateExerciseDto,
  ExerciseDetailDto,
  getExerciseDto,
} from '@packages/entities/exercise';
import { buildPagination } from '@packages/helpers';

type ExerciseUpdate = Partial<{
  exerciseUrls: Prisma.InputJsonValue;
  status: ExerciseStatus;
  score: string | null;
  comment: string | null;
  gradedAt: Date | null;
}>;

@Injectable()
export class ExerciseRepository {
  constructor(private readonly prisma: PrismaService) {}

  // numeric columns are Prisma Decimals — expose score as a number for the API
  private map(row: Exercise): ExerciseDetailDto {
    return {
      id: row.id,
      lessonId: row.lessonId,
      sessionId: row.sessionId,
      tutorId: row.tutorId,
      studentId: row.studentId,
      issueUrls: (row.issueUrls ?? []) as ExerciseDetailDto['issueUrls'],
      exerciseUrls: (row.exerciseUrls ?? []) as ExerciseDetailDto['exerciseUrls'],
      status: row.status,
      score: row.score !== null ? Number(row.score) : null,
      comment: row.comment,
      gradedAt: row.gradedAt ? row.gradedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async create({ data }: { data: CreateExerciseDto }): Promise<ExerciseDetailDto> {
    const row = await this.prisma.exercise.create({
      data: {
        tutorId: data.tutorId,
        studentId: data.studentId,
        sessionId: data.sessionId ?? null,
        lessonId: data.lessonId ?? null,
        issueUrls: data.issueUrls ?? [],
        exerciseUrls: data.exerciseUrls ?? [],
        status: data.status ?? 'SUBMITTED',
      },
    });
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
    const row = await this.prisma.exercise.findFirst({ where: { studentId, sessionId } });
    return row ? this.map(row) : null;
  }

  async findById({ id }: { id: string }): Promise<ExerciseDetailDto | null> {
    const row = await this.prisma.exercise.findUnique({ where: { id } });
    return row ? this.map(row) : null;
  }

  // list exercises the acting user can reach (as the tutor or the student on the row),
  // narrowed by the optional query filters.
  async findAll({ userId, query }: { userId: string; query: getExerciseDto }) {
    const { page, limit, sessionId, studentId, classId, tutorId } = query;

    const conditions: Prisma.ExerciseWhereInput[] = [
      { OR: [{ tutorId: userId }, { studentId: userId }] },
    ];
    if (sessionId) conditions.push({ sessionId });
    if (studentId) conditions.push({ studentId });
    if (tutorId) conditions.push({ tutorId });
    if (classId) conditions.push({ session: { classId } });
    const where: Prisma.ExerciseWhereInput = { AND: conditions };

    // enrich each row with the session, its class, and the student — the grades dashboard
    // renders these relations, while the flat fields keep the detail/submit UIs working.
    const [total, rows] = await Promise.all([
      this.prisma.exercise.count({ where }),
      this.prisma.exercise.findMany({
        where,
        include: {
          session: {
            select: {
              id: true,
              sessionNumber: true,
              classId: true,
              class: { select: { id: true, name: true, code: true } },
            },
          },
          student: {
            select: { id: true, firstName: true, lastName: true, userCode: true, avatar: true },
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: limit,
        skip: (page - 1) * limit,
      }),
    ]);

    return {
      data: rows.map(({ session, student, ...row }) => ({
        ...this.map(row),
        session: session
          ? { id: session.id, sessionNumber: session.sessionNumber, classId: session.classId }
          : null,
        class: session?.class ?? null,
        student,
      })),
      pagination: buildPagination(total, page, limit),
    };
  }

  async update({
    id,
    data,
  }: {
    id: string;
    data: ExerciseUpdate;
  }): Promise<ExerciseDetailDto | null> {
    try {
      const row = await this.prisma.exercise.update({ where: { id }, data });
      return this.map(row);
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }
}
