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
      .where(eq(tuitions.id, id));
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

  async getSummary(classId?: string) {
    const conditions: SQL[] = [];
    if (classId) conditions.push(eq(tuitions.classId, classId));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [paidRow] = await this.db
      .select({ total: sum(tuitions.amount) })
      .from(tuitions)
      .where(and(where, eq(tuitions.status, 'PAID')));
    const [unpaidRow] = await this.db
      .select({ total: sum(tuitions.amount) })
      .from(tuitions)
      .where(and(where, eq(tuitions.status, 'UNPAID')));
    const [overdueRow] = await this.db
      .select({ total: sum(tuitions.amount) })
      .from(tuitions)
      .where(and(where, eq(tuitions.status, 'OVERDUE')));

    return {
      totalPaid: Number(paidRow?.total ?? 0),
      totalUnpaid: Number(unpaidRow?.total ?? 0),
      totalOverdue: Number(overdueRow?.total ?? 0),
      totalRevenue: Number(paidRow?.total ?? 0),
    };
  }
}
