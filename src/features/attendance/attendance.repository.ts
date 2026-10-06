import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
import { attendances } from 'src/database/schema';
import type { UpsertAttendanceDto } from '@packages/entities/attendance';

@Injectable()
export class AttendanceRepository {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: ReturnType<typeof drizzle>,
  ) {}

  async findBySession({ sessionId }: { sessionId: string }) {
    return this.db.select().from(attendances).where(eq(attendances.sessionId, sessionId));
  }

  async findOne({ sessionId, studentId }: { sessionId: string; studentId: string }) {
    const [row] = await this.db
      .select()
      .from(attendances)
      .where(and(eq(attendances.sessionId, sessionId), eq(attendances.studentId, studentId)))
      .limit(1);
    return row ?? null;
  }

  async upsert({ data }: { data: UpsertAttendanceDto }) {
    const [row] = await this.db
      .insert(attendances)
      .values({
        sessionId: data.sessionId,
        studentId: data.studentId,
        present: data.present,
        note: data.note ?? null,
      })
      .onConflictDoUpdate({
        target: [attendances.sessionId, attendances.studentId],
        set: {
          present: data.present,
          note: data.note ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }
}
