import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import { canActOnOwned, checkUuidValid } from '@packages/helpers';
import type { AttendanceRecordDto, UpsertAttendanceDto } from '@packages/entities/attendance';
import { AttendanceRepository } from './attendance.repository';
import { SessionService } from '../session/session.service';
import { ClassService } from '../class/class.service';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly repo: AttendanceRepository,
    private readonly sessionService: SessionService,
    private readonly classService: ClassService,
  ) {}

  private assertUuid(value: string | null | undefined, label: string) {
    if (!value || !checkUuidValid({ data: value })) {
      throw new BadRequestException(`${ERROR_MESSAGES.ID_MUST_BE_UUID}: ${label}`);
    }
  }

  // read access mirrors session detail: class tutor (owner), an enrolled student, or their parent
  async getBySessionService({
    userId,
    role,
    sessionId,
  }: {
    userId: string;
    role?: string | null;
    sessionId: string;
  }): Promise<AttendanceRecordDto[]> {
    this.assertUuid(userId, 'User Id');
    this.assertUuid(sessionId, 'Session Id');

    const session = await this.sessionService.getSessionService({ userId, role, id: sessionId });
    const roster = await this.classService.getAllStudentsService({
      userId,
      role,
      id: session.classId,
    });
    const records = await this.repo.findBySession({ sessionId });
    const byStudent = new Map(records.map((r) => [r.studentId, r]));

    return roster.map((student) => {
      const record = byStudent.get(student.id);
      return {
        studentId: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        avatar: student.avatar,
        userCode: student.userCode,
        present: record?.present ?? false,
        note: record?.note ?? null,
        markedAt: record ? record.updatedAt.toISOString() : null,
      };
    });
  }

  // tutor (class owner) marks/updates one student's attendance for a session
  async upsertAttendanceService({
    userId,
    role,
    data,
  }: {
    userId: string;
    role?: string | null;
    data: UpsertAttendanceDto;
  }) {
    this.assertUuid(userId, 'User Id');
    this.assertUuid(data.sessionId, 'sessionId');
    this.assertUuid(data.studentId, 'studentId');

    const session = await this.sessionService.getSessionService({
      userId,
      role,
      id: data.sessionId,
    });
    if (!canActOnOwned({ userId, role }, session.class?.tutorId)) {
      throw new ForbiddenException(ERROR_MESSAGES.ATTENDANCE_MARK_NOT_ALLOWED);
    }

    const roster = await this.classService.getAllStudentsService({
      userId,
      role,
      id: session.classId,
    });
    if (!roster.some((s) => s.id === data.studentId)) {
      throw new NotFoundException(ERROR_MESSAGES.STUDENT_NOT_FOUND);
    }

    return this.repo.upsert({ data });
  }
}
