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
  answerKeyUrls: Prisma.InputJsonValue;
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
      answerKeyUrls: (row.answerKeyUrls ?? []) as ExerciseDetailDto['answerKeyUrls'],
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

  /**
   * Quyền tải file theo key (R2 object key). Trả về true nếu user liên quan tới buổi học / bài tập /
   * bài giảng có chứa key đó:
   * - buổi học: gia sư của lớp, học sinh đang học lớp, phụ huynh của học sinh đó;
   * - bài tập (đề, bài nộp, đáp án): gia sư chấm, học sinh làm bài, phụ huynh của học sinh;
   * - bài giảng (lesson): mọi TUTOR.
   * Dùng `position(key in cột::text)` thay LIKE để key không bị hiểu như wildcard.
   */
  async canAccessFile({ key, userId, role }: { key: string; userId: string; role?: string | null }) {
    if (role === 'ADMIN') return true;
    const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT (
        EXISTS (
          SELECT 1 FROM class_sessions s
          JOIN classes c ON c.id = s.class_id
          WHERE (position(${key} in s.theory_urls::text) > 0 OR position(${key} in s.exercise_urls::text) > 0)
            AND (
              c.tutor_id = ${userId}::uuid
              OR EXISTS (
                SELECT 1 FROM class_students cs
                JOIN users st ON st.id = cs.student_id
                WHERE cs.class_id = c.id
                  AND (cs.student_id = ${userId}::uuid OR st.parent_id = ${userId}::uuid)
              )
            )
        )
        OR EXISTS (
          SELECT 1 FROM exercises e
          JOIN users st ON st.id = e.student_id
          WHERE (position(${key} in e.issue_urls::text) > 0 OR position(${key} in e.exercise_urls::text) > 0)
            AND (e.tutor_id = ${userId}::uuid OR e.student_id = ${userId}::uuid OR st.parent_id = ${userId}::uuid)
        )
        -- đáp án: gia sư luôn xem; học sinh/phụ huynh chỉ xem sau khi bài đã được chấm
        OR EXISTS (
          SELECT 1 FROM exercises e
          JOIN users st ON st.id = e.student_id
          WHERE position(${key} in e.answer_key_urls::text) > 0
            AND (
              e.tutor_id = ${userId}::uuid
              OR (e.status = 'GRADED' AND (e.student_id = ${userId}::uuid OR st.parent_id = ${userId}::uuid))
            )
        )
        OR (
          ${role ?? ''} = 'TUTOR'
          AND EXISTS (
            SELECT 1 FROM lessons l
            WHERE position(${key} in l.theory_urls::text) > 0 OR position(${key} in l.exercise_urls::text) > 0
          )
        )
      ) AS ok
    `;
    return rows[0]?.ok === true;
  }

  /** True when `parentId` is the PARENT of `studentId` (student.parentId). */
  async isParentOfStudent({ parentId, studentId }: { parentId: string; studentId: string }) {
    const count = await this.prisma.user.count({ where: { id: studentId, parentId } });
    return count > 0;
  }

  // list exercises the acting user can reach (as the tutor or the student on the row),
  // narrowed by the optional query filters.
  async findAll({
    userId,
    role,
    query,
  }: {
    userId: string;
    role?: string | null;
    query: getExerciseDto;
  }) {
    const { page, limit, sessionId, studentId, classId, tutorId } = query;

    // tutor (owner), the student on the row, or the PARENT of that student (student.parentId)
    const conditions: Prisma.ExerciseWhereInput[] = [
      {
        OR: [
          { tutorId: userId },
          { studentId: userId },
          { student: { parentId: userId } },
        ],
      },
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

  // `notStatus` makes the write conditional (e.g. never overwrite a GRADED row): the check and
  // the write are one statement, so a concurrent grade cannot be clobbered by a resubmit.
  async update({
    id,
    data,
    notStatus,
  }: {
    id: string;
    data: ExerciseUpdate;
    notStatus?: ExerciseStatus;
  }): Promise<ExerciseDetailDto | null> {
    try {
      const row = await this.prisma.exercise.update({
        where: { id, ...(notStatus ? { status: { not: notStatus } } : {}) },
        data,
      });
      return this.map(row);
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }
}
