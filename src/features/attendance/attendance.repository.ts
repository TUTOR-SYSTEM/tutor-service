import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { UpsertAttendanceDto } from '@packages/entities/attendance';

@Injectable()
export class AttendanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findBySession({ sessionId }: { sessionId: string }) {
    return this.prisma.attendance.findMany({ where: { sessionId } });
  }

  async findOne({ sessionId, studentId }: { sessionId: string; studentId: string }) {
    return this.prisma.attendance.findUnique({
      where: { sessionId_studentId: { sessionId, studentId } },
    });
  }

  async upsert({ data }: { data: UpsertAttendanceDto }) {
    const note = data.note ?? null;
    return this.prisma.attendance.upsert({
      where: { sessionId_studentId: { sessionId: data.sessionId, studentId: data.studentId } },
      create: {
        sessionId: data.sessionId,
        studentId: data.studentId,
        present: data.present,
        note,
      },
      update: { present: data.present, note },
    });
  }
}
