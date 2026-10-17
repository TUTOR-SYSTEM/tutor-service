import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  constructor(
    private readonly repo: SessionRepository,
    private readonly classService: ClassService,
    private readonly lessonService: LessonService,
    private readonly userService: UserService,
  ) {}

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
    const refs = await this.resolveSessionRefs({
      defaultTutorId: classData.tutorId,
      lessonId: data.lessonId,
      tutorId: data.tutorId,
    });
    const created = await this.repo.create({ data: { ...data, ...refs } });
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
    // partial update: check the new bounds against the stored ones
    this.assertSessionTimeRange(data.startAt ?? current.startAt, data.endAt ?? current.endAt);

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
