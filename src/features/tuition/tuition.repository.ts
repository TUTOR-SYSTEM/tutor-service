import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, isRecordNotFound } from '../../database/prisma.service';
import type {
  CreateTuitionDto,
  GetTuitionsQueryDto,
  UpdateTuitionDto,
} from '@packages/entities/tuition';
import { buildPagination } from '@packages/helpers';
import { toDate } from '@packages/helpers/date.helper';

const TUITION_INCLUDE = {
  class: { select: { name: true, code: true } },
  student: {
    select: { firstName: true, lastName: true, userCode: true, phone: true, avatar: true },
  },
} satisfies Prisma.TuitionInclude;

type TuitionWithRelations = Prisma.TuitionGetPayload<{ include: typeof TUITION_INCLUDE }>;

@Injectable()
export class TuitionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** A user may read a tuition if they are its student or the tutor of its class. */
  private canRead(userId: string): Prisma.TuitionWhereInput {
    return { OR: [{ studentId: userId }, { class: { tutorId: userId } }] };
  }

  private serialize({ class: cls, student, ...tuition }: TuitionWithRelations) {
    return {
      ...tuition,
      // decimals are exposed as fixed 2-digit strings, same as the numeric column text
      amount: tuition.amount != null ? tuition.amount.toFixed(2) : '0',
      class: { id: tuition.classId, name: cls.name, code: cls.code },
      student: {
        id: tuition.studentId,
        firstName: student.firstName,
        lastName: student.lastName,
        userCode: student.userCode,
        phone: student.phone,
        avatar: student.avatar,
      },
    };
  }

  async create(data: CreateTuitionDto) {
    const tuition = await this.prisma.tuition.create({
      data: {
        classId: data.classId,
        studentId: data.studentId,
        amount: String(data.amount),
        dueDate: toDate(data.dueDate) ?? null,
        paidDate: toDate(data.paidDate) ?? null,
        status: data.status ?? 'UNPAID',
        note: data.note ?? null,
      },
    });
    return this.findById(tuition.id);
  }

  async findAll({
    userId,
    role,
    query,
  }: {
    userId: string;
    role?: string | null;
    query: GetTuitionsQueryDto;
  }) {
    const { page, limit, classId, studentId, status } = query;
    const where: Prisma.TuitionWhereInput = {
      AND: [this.canRead(userId), { classId, studentId, status }],
    };

    const [total, rows] = await Promise.all([
      this.prisma.tuition.count({ where }),
      this.prisma.tuition.findMany({
        where,
        include: TUITION_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: (page - 1) * limit,
      }),
    ]);

    return {
      tuitions: rows.map((r) => this.serialize(r)),
      pagination: buildPagination(total, page, limit),
    };
  }

  /** When `userId` is given the row is only returned if that user may read it. */
  async findById(id: string, userId?: string) {
    const row = await this.prisma.tuition.findFirst({
      where: { id, ...(userId && this.canRead(userId)) },
      include: TUITION_INCLUDE,
    });
    return row ? this.serialize(row) : null;
  }

  /** Only the editable fields are written: classId/studentId can never move a tuition. */
  async update(id: string, data: UpdateTuitionDto) {
    const { amount, dueDate, paidDate, status, note } = data;
    try {
      await this.prisma.tuition.update({
        where: { id },
        data: {
          ...(amount !== undefined && { amount: String(amount) }),
          ...(status !== undefined && { status }),
          ...(note !== undefined && { note }),
          ...(dueDate !== undefined && { dueDate: toDate(dueDate) }),
          ...(paidDate !== undefined && { paidDate: toDate(paidDate) }),
        },
      });
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
    return this.findById(id);
  }

  async isStudentEnrolled({ classId, studentId }: { classId: string; studentId: string }) {
    const row = await this.prisma.classStudent.findFirst({
      where: { classId, studentId },
      select: { id: true },
    });
    return !!row;
  }

  async delete(id: string) {
    const { count } = await this.prisma.tuition.deleteMany({ where: { id } });
    return count > 0;
  }

  /** Owning tutor of a class (2 columns, no joins) for ownership checks. */
  async getClassTutorId(classId: string): Promise<string | null> {
    const row = await this.prisma.class.findUnique({
      where: { id: classId },
      select: { tutorId: true },
    });
    return row?.tutorId ?? null;
  }

  /** Tuition + its class's tutor in one query, for update/delete ownership checks. */
  async findOwnerById(
    id: string,
  ): Promise<{ id: string; tutorId: string; status: string | null } | null> {
    const row = await this.prisma.tuition.findUnique({
      where: { id },
      select: { id: true, status: true, class: { select: { tutorId: true } } },
    });
    return row ? { id: row.id, tutorId: row.class.tutorId, status: row.status } : null;
  }

  /** Revenue summary over the classes the tutor owns (optionally narrowed to one class). */
  async getSummary({ userId, classId }: { userId: string; classId?: string }) {
    // one grouped scan instead of three sequential sum() queries
    const rows = await this.prisma.tuition.groupBy({
      by: ['status'],
      where: { class: { tutorId: userId }, classId },
      _sum: { amount: true },
    });

    const totalOf = (status: string) =>
      Number(rows.find((r) => r.status === status)?._sum.amount ?? 0);
    const totalPaid = totalOf('PAID');

    return {
      totalPaid,
      totalUnpaid: totalOf('UNPAID'),
      totalOverdue: totalOf('OVERDUE'),
      totalRevenue: totalPaid,
    };
  }
}
