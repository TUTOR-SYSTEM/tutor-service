import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, type SQL, sum } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
import { classes, tuitions, users } from '@tutor/gateway/schema';
import type { CreateTuitionDto, GetTuitionsQueryDto } from '@packages/entities/tuition';

@Injectable()
export class TuitionRepository {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: ReturnType<typeof drizzle>,
  ) {}

  private readonly joinedColumns = {
    tuition: tuitions,
    className: classes.name,
    classCode: classes.code,
    studentFirstName: users.firstName,
    studentLastName: users.lastName,
    studentUserCode: users.userCode,
    studentPhone: users.phone,
    studentAvatar: users.avatar,
  };

  private serialize(r: {
    tuition: typeof tuitions.$inferSelect;
    className: string;
    classCode: string;
    studentFirstName: string;
    studentLastName: string;
    studentUserCode: string | null;
    studentPhone: string | null;
    studentAvatar: string | null;
  }) {
    return {
      ...r.tuition,
      amount: r.tuition.amount != null ? String(r.tuition.amount) : '0',
      class: { id: r.tuition.classId, name: r.className, code: r.classCode },
      student: {
        id: r.tuition.studentId,
        firstName: r.studentFirstName,
        lastName: r.studentLastName,
        userCode: r.studentUserCode,
        phone: r.studentPhone,
        avatar: r.studentAvatar,
      },
    };
  }

  async create(data: CreateTuitionDto) {
    const [tuition] = await this.db
      .insert(tuitions)
      .values({
        classId: data.classId,
        studentId: data.studentId,
        amount: String(data.amount),
        dueDate: data.dueDate ?? null,
        paidDate: data.paidDate ?? null,
        status: data.status ?? 'UNPAID',
        note: data.note ?? null,
      })
      .returning();
    return this.findById(tuition.id);
  }

  async findAll(query: GetTuitionsQueryDto) {
    const { page, limit, classId, studentId, status } = query;
    const conditions: SQL[] = [];

    if (classId) conditions.push(eq(tuitions.classId, classId));
    if (studentId) conditions.push(eq(tuitions.studentId, studentId));
    if (status) conditions.push(eq(tuitions.status, status));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * limit;

    const [totalRow] = await this.db.select({ total: count() }).from(tuitions).where(where);
    const total = Number(totalRow?.total ?? 0);

    const rows = await this.db
      .select(this.joinedColumns)
      .from(tuitions)
      .innerJoin(classes, eq(tuitions.classId, classes.id))
      .innerJoin(users, eq(tuitions.studentId, users.id))
      .where(where)
      .orderBy(desc(tuitions.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      tuitions: rows.map((r) => this.serialize(r)),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findById(id: string) {
    const [row] = await this.db
      .select(this.joinedColumns)
      .from(tuitions)
      .innerJoin(classes, eq(tuitions.classId, classes.id))
      .innerJoin(users, eq(tuitions.studentId, users.id))
      .where(eq(tuitions.id, id))
      .limit(1);
    return row ? this.serialize(row) : null;
  }

  async update(id: string, data: Record<string, unknown>) {
    const [tuition] = await this.db
      .update(tuitions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(tuitions.id, id))
      .returning();
    if (!tuition) return null;
    return this.findById(id);
  }

  async delete(id: string) {
    const [tuition] = await this.db.delete(tuitions).where(eq(tuitions.id, id)).returning();
    return !!tuition;
  }

  /** Owning tutor of a class (2 columns, no joins) for ownership checks. */
  async getClassTutorId(classId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ tutorId: classes.tutorId })
      .from(classes)
      .where(eq(classes.id, classId))
      .limit(1);
    return row?.tutorId ?? null;
  }

  /** Tuition + its class's tutor in one query, for update/delete ownership checks. */
  async findOwnerById(id: string): Promise<{ id: string; tutorId: string } | null> {
    const [row] = await this.db
      .select({ id: tuitions.id, tutorId: classes.tutorId })
      .from(tuitions)
      .innerJoin(classes, eq(tuitions.classId, classes.id))
      .where(eq(tuitions.id, id))
      .limit(1);
    return row ?? null;
  }

  async getSummary(classId?: string) {
    const where = classId ? eq(tuitions.classId, classId) : undefined;

    // one grouped scan instead of three sequential sum() queries
    const rows = await this.db
      .select({ status: tuitions.status, total: sum(tuitions.amount) })
      .from(tuitions)
      .where(where)
      .groupBy(tuitions.status);

    const totalOf = (status: string) => Number(rows.find((r) => r.status === status)?.total ?? 0);
    const totalPaid = totalOf('PAID');

    return {
      totalPaid,
      totalUnpaid: totalOf('UNPAID'),
      totalOverdue: totalOf('OVERDUE'),
      totalRevenue: totalPaid,
    };
  }
}
