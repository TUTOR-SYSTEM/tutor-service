import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import {
  CreateSessionDto,
  CreateSessionsDto,
  GetSessionsQueryDto,
  UpdateSessionDto,
} from '@packages/entities/session';
import { canActOnOwned, checkUuidValid } from '@packages/helpers';
import { SessionRepository } from './session.repository';
import { ClassService } from '../class/class.service';
import { LessonService } from '../lesson/lesson.service';
import { UserService } from '../user/user.service';
import { NotificationNotifier } from '../notification/notification.notifier';

const formatVn = (value: unknown) => {
  const d = new Date(value as string);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
};

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  constructor(
    private readonly repo: SessionRepository,
    private readonly classService: ClassService,
    private readonly lessonService: LessonService,
    private readonly userService: UserService,
    private readonly notifier: NotificationNotifier,
  ) {}

  /** Thông báo cho mọi học sinh trong lớp (lỗi chỉ log, không ảnh hưởng nghiệp vụ). */
  private async notifyClassStudents({
    userId,
    role,
    classId,
    sessionId,
    title,
    content,
  }: {
    userId: string;
    role?: string | null;
    classId: string;
    /** Buổi liên quan: có thì thông báo mở thẳng trang buổi, không thì mở trang lớp. */
    sessionId?: string;
    title: string;
    content: string;
  }) {
    try {
      const roster = await this.classService.getRosterStudentIdsService({ classId });
      await this.notifier.notifyUsers({
        role,
        senderId: userId,
        recipients: roster ?? [],
        type: 'STUDENT',
        title,
        content,
        redirectUrl: sessionId
          ? `/classes/${classId}/sessions/${sessionId}`
          : `/classes/${classId}`,
      });
    } catch (error) {
      this.logger.warn(`Gửi thông báo buổi học thất bại: ${(error as Error).message}`);
    }
  }

  private async resolveSessionRefs({
    defaultTutorId,
    lessonId,
    tutorId,
  }: {
    defaultTutorId: string;
    lessonId?: string | null;
    tutorId?: string | null;
  }): Promise<{ lessonId: string | null; tutorId: string }> {
    if (lessonId) {
      const lesson = await this.lessonService.getLessonByIdService({ id: lessonId });
      if (!lesson) throw new NotFoundException(ERROR_MESSAGES.LESSON_NOT_FOUND);
    }

    // default the session tutor to the class tutor; an explicit tutorId must be a TUTOR/ADMIN
    // user, otherwise a student could be recorded as the teacher of a session.
    if (tutorId && tutorId !== defaultTutorId) {
      const tutor = await this.userService.getUserRoleById(tutorId);
      if (!tutor || (tutor.role !== 'TUTOR' && tutor.role !== 'ADMIN'))
        throw new NotFoundException(ERROR_MESSAGES.TUTOR_NOT_FOUND);
    }

    return { lessonId: lessonId ?? null, tutorId: tutorId ?? defaultTutorId };
  }

  // write gate: the class owner (tutor) or ADMIN; returns the class row (its tutorId is the default)
  private async assertClassOwner({
    userId,
    role,
    classId,
  }: {
    userId: string;
    role?: string | null;
    classId: string;
  }) {
    return this.classService.getOwnedClassService({ userId, role, id: classId });
  }

  // sessionNumber is unique per class (enforced here, not by a DB constraint: existing rows may
  // already collide). Rejects numbers already stored in the class and duplicates inside a payload.
  private async assertSessionNumbersFree({
    classId,
    numbers,
    excludeId,
  }: {
    classId: string;
    numbers: number[];
    excludeId?: string;
  }) {
    const requested = numbers.filter((n) => n !== undefined && n !== null);
    if (new Set(requested).size !== requested.length)
      throw new ConflictException(ERROR_MESSAGES.SESSION_NUMBER_DUPLICATE);
    if (requested.length === 0) return;
    const taken = await this.repo.findTakenSessionNumbers({
      classId,
      numbers: requested,
      excludeId,
    });
    if (taken.length > 0) throw new ConflictException(ERROR_MESSAGES.SESSION_NUMBER_DUPLICATE);
  }

  // session.startAt / endAt arrive as ISO strings over RMQ; the end must be after the start
  private assertSessionTimeRange(startAt: unknown, endAt: unknown) {
    if (startAt === undefined || startAt === null || endAt === undefined || endAt === null) return;
    const start = new Date(startAt as string).getTime();
    const end = new Date(endAt as string).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start)
      throw new BadRequestException(ERROR_MESSAGES.TIME_RANGE_INVALID);
  }

  // a session counts as "ended" only once the tutor marks it COMPLETED — students and parents
  // may see the assigned exercises (bài tập) only after this point (a SCHEDULED/ONGOING session
  // whose planned end time has merely passed does NOT unlock them).
  private isSessionEnded(session: { status: string }) {
    return session.status === 'COMPLETED';
  }

  // hide session.exerciseUrls from non-owners (student/parent) until the session has ended
  private gateExercises<T extends { status: string; exerciseUrls?: unknown }>(
    session: T,
    isOwner: boolean,
  ): T {
    if (isOwner || this.isSessionEnded(session)) return session;
    return { ...session, exerciseUrls: [] };
  }

  private async loadOwnedSession({
    userId,
    role,
    id,
  }: {
    userId: string;
    role?: string | null;
    id: string;
  }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.SESSION_ID_MUST_BE_UUID);

    const session = await this.repo.getById({ id });
    if (!session) throw new NotFoundException(ERROR_MESSAGES.SESSION_NOT_FOUND);

    await this.assertClassOwner({ userId, role, classId: session.classId });
    return session;
  }

  async createSessionService({
    userId,
    role,
    data,
  }: {
    userId: string;
    role?: string | null;
    data: CreateSessionDto;
  }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);

    this.assertSessionTimeRange(data.startAt, data.endAt);
    const classData = await this.assertClassOwner({ userId, role, classId: data.classId });
    await this.assertSessionNumbersFree({ classId: data.classId, numbers: [data.sessionNumber] });
    const refs = await this.resolveSessionRefs({
      defaultTutorId: classData.tutorId,
      lessonId: data.lessonId,
      tutorId: data.tutorId,
    });
    const created = await this.repo.create({ data: { ...data, ...refs } });
    const when = formatVn(created?.startAt ?? data.startAt);
    await this.notifyClassStudents({
      userId,
      role,
      classId: data.classId,
      title: 'Lịch học mới',
      content: `Buổi ${data.sessionNumber}${data.title ? `: ${data.title}` : ''}${when ? ` — ${when}` : ''}`,
    });
    return created;
  }

  async createSessionsService({
    userId,
    role,
    data,
  }: {
    userId: string;
    role?: string | null;
    data: CreateSessionsDto;
  }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);

    for (const session of data.sessions)
      this.assertSessionTimeRange(session.startAt, session.endAt);
    const classData = await this.assertClassOwner({ userId, role, classId: data.classId });
    await this.assertSessionNumbersFree({
      classId: data.classId,
      numbers: data.sessions.map((session) => session.sessionNumber),
    });
    // resolve each distinct lesson/tutor once, not once per session
    const refCache = new Map<string, Promise<{ lessonId: string | null; tutorId: string }>>();
    const resolveRefs = (lessonId?: string | null, tutorId?: string | null) => {
      const key = `${lessonId ?? ''}|${tutorId ?? ''}`;
      let pending = refCache.get(key);
      if (!pending) {
        pending = this.resolveSessionRefs({
          defaultTutorId: classData.tutorId,
          lessonId,
          tutorId,
        });
        refCache.set(key, pending);
      }
      return pending;
    };
    const items = await Promise.all(
      data.sessions.map(async (session) => ({
        ...session,
        ...(await resolveRefs(session.lessonId, session.tutorId)),
      })),
    );
    const created = await this.repo.createMany({ classId: data.classId, items });
    if (items.length === 1) {
      const [only] = items;
      const when = formatVn(only.startAt);
      await this.notifyClassStudents({
        userId,
        role,
        classId: data.classId,
        title: 'Lịch học mới',
        content: `Buổi ${only.sessionNumber}${only.title ? `: ${only.title}` : ''}${when ? ` — ${when}` : ''}`,
      });
    } else if (items.length > 1) {
      await this.notifyClassStudents({
        userId,
        role,
        classId: data.classId,
        title: 'Lịch học mới',
        content: `Lớp có ${items.length} buổi học mới được thêm vào lịch.`,
      });
    }
    return created;
  }

  async getSessionsService({
    userId,
    role,
    query,
  }: {
    userId: string;
    role?: string | null;
    query: GetSessionsQueryDto;
  }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);

    const result = await this.repo.getAll({ userId, role, query });
    return {
      ...result,
      sessions: result.sessions.map((session) =>
        this.gateExercises(session, canActOnOwned({ userId, role }, session.class?.tutorId)),
      ),
    };
  }

  async getSessionsByClassService({
    userId,
    role,
    classId,
  }: {
    userId: string;
    role?: string | null;
    classId: string;
  }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);

    await this.assertClassOwner({ userId, role, classId });
    return this.repo.getByClass({ classId });
  }

  // detail read is allowed for the class tutor (owner) OR an enrolled student
  async getSessionService({
    userId,
    role,
    id,
  }: {
    userId: string;
    role?: string | null;
    id: string;
  }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.SESSION_ID_MUST_BE_UUID);

    const detail = await this.repo.getDetailById({ id });
    if (!detail) throw new NotFoundException(ERROR_MESSAGES.SESSION_NOT_FOUND);

    // access: class tutor (owner), an enrolled student, or a parent of an enrolled student
    const isOwner = canActOnOwned({ userId, role }, detail.class?.tutorId);
    const canAccess =
      isOwner ||
      (await this.repo.isEnrolled({ userId, classId: detail.classId })) ||
      (await this.repo.isParentOfEnrolled({ userId, classId: detail.classId }));
    if (!canAccess) throw new NotFoundException(ERROR_MESSAGES.SESSION_NOT_FOUND);

    // students & parents only see the assigned exercises after the session has ended
    return this.gateExercises(detail, isOwner);
  }

  async updateSessionService({
    userId,
    role,
    id,
    data,
  }: {
    userId: string;
    role?: string | null;
    id: string;
    data: UpdateSessionDto;
  }) {
    const current = await this.loadOwnedSession({ userId, role, id });
    // Buổi vừa chuyển sang COMPLETED: giao bài tập trước, rồi mới lưu trạng thái. Nếu giao lỗi
    // thì buổi vẫn chưa COMPLETED và có thể bấm kết thúc lại (giao bài là idempotent).
    // Thông báo học sinh chỉ gửi SAU khi lưu thành công, để không báo "có bài tập" cho buổi
    // vẫn chưa COMPLETED.
    const homework = {
      role,
      id,
      classId: current.classId,
      tutorId: data.tutorId ?? current.tutorId,
      title: data.title ?? current.title,
      sessionNumber: data.sessionNumber ?? current.sessionNumber,
      exerciseUrls: data.exerciseUrls ?? current.exerciseUrls,
      exerciseDueAt: data.exerciseDueAt ?? current.exerciseDueAt,
    };
    const newStudentIds =
      data.status === 'COMPLETED' && current.status !== 'COMPLETED'
        ? await this.assignHomeworkOnComplete(homework)
        : [];
    const updated = await this.applySessionUpdate({ userId, id, data, current });
    if (newStudentIds.length > 0) {
      await this.notifyHomeworkAssigned(homework, newStudentIds);
    }
    await this.notifySessionChange({ userId, role, data, current });
    return updated;
  }

  /** Hủy/hoãn hoặc đổi lịch/địa điểm → báo học sinh trong lớp. */
  private async notifySessionChange({
    userId,
    role,
    data,
    current,
  }: {
    userId: string;
    role?: string | null;
    data: UpdateSessionDto;
    current: {
      id: string;
      classId: string;
      sessionNumber: number;
      title: string | null;
      startAt: Date;
      endAt: Date;
      location: string | null;
      status: string;
    };
  }) {
    const label = `Buổi ${data.sessionNumber ?? current.sessionNumber}${(data.title ?? current.title) ? `: ${data.title ?? current.title}` : ''}`;
    const newStatus = data.status;
    if (
      newStatus &&
      newStatus !== current.status &&
      (newStatus === 'CANCELLED' || newStatus === 'POSTPONED')
    ) {
      await this.notifyClassStudents({
        userId,
        role,
        classId: current.classId,
        sessionId: current.id,
        title: newStatus === 'CANCELLED' ? 'Buổi học bị hủy' : 'Buổi học được hoãn',
        content: label,
      });
      return;
    }
    if (newStatus === 'COMPLETED' && current.status !== 'COMPLETED') return;

    const changes: string[] = [];
    const time = (v: unknown) => new Date(v as string).getTime();
    if (data.startAt !== undefined && time(data.startAt) !== time(current.startAt))
      changes.push(`Giờ bắt đầu mới: ${formatVn(data.startAt)}`);
    if (data.endAt !== undefined && time(data.endAt) !== time(current.endAt))
      changes.push(`Giờ kết thúc mới: ${formatVn(data.endAt)}`);
    if (data.location !== undefined && (data.location ?? null) !== (current.location ?? null))
      changes.push(`Địa điểm mới: ${data.location || 'chưa xác định'}`);
    if (changes.length === 0) return;
    await this.notifyClassStudents({
      userId,
      role,
      classId: current.classId,
      sessionId: current.id,
      title: 'Buổi học thay đổi lịch/địa điểm',
      content: `${label} — ${changes.join('; ')}`,
    });
  }

  /** Giao bài tập của buổi cho mọi học sinh trong lớp (idempotent). Trả về id học sinh mới được giao. */
  private async assignHomeworkOnComplete(session: {
    /** Vai trò người kết thúc buổi — gateway/notification kiểm quyền theo role này. */
    role?: string | null;
    id: string;
    classId: string;
    tutorId: string | null;
    title: string | null;
    sessionNumber: number;
    exerciseUrls: unknown;
    exerciseDueAt: Date | string | null;
  }) {
    if (!Array.isArray(session.exerciseUrls) || session.exerciseUrls.length === 0) return [];
    if (!session.tutorId) return [];

    const roster = await this.classService.getRosterStudentIdsService({ classId: session.classId });
    const already = new Set(await this.repo.findExerciseStudentIds({ sessionId: session.id }));
    const newStudentIds = roster.filter((studentId) => !already.has(studentId));
    if (newStudentIds.length === 0) return [];

    await this.repo.createAssignedExercises({
      sessionId: session.id,
      tutorId: session.tutorId,
      studentIds: newStudentIds,
    });
    return newStudentIds;
  }

  /** Gửi thông báo "bài tập mới" cho các học sinh vừa được giao (gọi sau khi buổi đã lưu). */
  private async notifyHomeworkAssigned(
    session: {
      role?: string | null;
      id: string;
      classId: string;
      tutorId: string | null;
      title: string | null;
      sessionNumber: number;
      exerciseDueAt: Date | string | null;
    },
    studentIds: string[],
  ) {
    if (!session.tutorId) return;
    // exerciseDueAt có thể đến dưới dạng chuỗi ISO (RPC) nên luôn parse lại
    const dueAt = session.exerciseDueAt ? new Date(session.exerciseDueAt) : null;
    const due =
      dueAt && !Number.isNaN(dueAt.getTime())
        ? `Hạn nộp: ${dueAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`
        : 'Chưa có hạn nộp';
    const title = `Buổi ${session.sessionNumber}${session.title ? `: ${session.title}` : ''}`;
    // NotificationNotifier gửi từng người nhận và chỉ log lỗi (không làm fail việc kết thúc buổi)
    await this.notifier.notifyUsers({
      role: session.role,
      senderId: session.tutorId,
      recipients: studentIds,
      type: 'STUDENT',
      title: 'Bài tập mới cần nộp',
      content: `${title} đã có bài tập về nhà.`,
      subContent: due,
      redirectUrl: `/classes/${session.classId}/sessions/${session.id}/exercise`,
    });
  }

  private async applySessionUpdate({
    userId,
    id,
    data,
    current,
  }: {
    userId: string;
    id: string;
    data: UpdateSessionDto;
    current: {
      classId: string;
      lessonId: string | null;
      tutorId: string | null;
      sessionNumber: number;
      startAt: Date;
      endAt: Date;
      status: string;
    };
  }) {
    // partial update: check the new bounds against the stored ones
    this.assertSessionTimeRange(data.startAt ?? current.startAt, data.endAt ?? current.endAt);

    if (data.sessionNumber !== undefined && data.sessionNumber !== current.sessionNumber)
      await this.assertSessionNumbersFree({
        classId: current.classId,
        numbers: [data.sessionNumber],
        excludeId: id,
      });

    // re-validate changed FKs exactly as create does
    if (data.lessonId !== undefined || data.tutorId !== undefined) {
      const refs = await this.resolveSessionRefs({
        defaultTutorId: current.tutorId ?? userId,
        lessonId: data.lessonId !== undefined ? data.lessonId : current.lessonId,
        tutorId: data.tutorId,
      });
      return this.repo.update({ id, data: { ...data, ...refs } });
    }
    return this.repo.update({ id, data });
  }

  async delSessionService({
    userId,
    role,
    id,
  }: {
    userId: string;
    role?: string | null;
    id: string;
  }) {
    await this.loadOwnedSession({ userId, role, id });

    const deleted = await this.repo.del({ id });
    if (!deleted) throw new NotFoundException(ERROR_MESSAGES.SESSION_NOT_FOUND);

    return { id };
  }
}
