import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import {
  CreateSessionDto,
  CreateSessionsDto,
  GetSessionsQueryDto,
  UpdateSessionDto,
} from '@packages/entities/session';
import { checkUuidValid } from '@packages/helpers';
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

  // todo : validate optional lesson/tutor FKs before insert, defaulting tutor to the acting user ...
  private async resolveSessionRefs({
    userId,
    lessonId,
    tutorId,
  }: {
    userId: string;
    lessonId?: string | null;
    tutorId?: string | null;
  }): Promise<{ lessonId: string | null; tutorId: string }> {
    if (lessonId) {
      const lesson = await this.lessonService.getLessonByIdService({ id: lessonId });
      if (!lesson) throw new NotFoundException(ERROR_MESSAGES.LESSON_NOT_FOUND);
    }

    // the acting tutor owns the class, so default the session tutor to them; if an explicit
    // tutorId is supplied, it must reference a real user.
    if (tutorId && tutorId !== userId) {
      if (!(await this.userService.userExists(tutorId)))
        throw new NotFoundException(ERROR_MESSAGES.TUTOR_NOT_FOUND);
    }

    return { lessonId: lessonId ?? null, tutorId: tutorId ?? userId };
  }

  // todo : ensure the acting user owns the target class ...
  private async assertClassOwner({ userId, classId }: { userId: string; classId: string }) {
    return this.classService.getOwnedClassService({ userId, id: classId });
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

  private async loadOwnedSession({ userId, id }: { userId: string; id: string }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.SESSION_ID_MUST_BE_UUID);

    const session = await this.repo.getById({ id });
    if (!session) throw new NotFoundException(ERROR_MESSAGES.SESSION_NOT_FOUND);

    await this.assertClassOwner({ userId, classId: session.classId });
    return session;
  }

  async createSessionService({ userId, data }: { userId: string; data: CreateSessionDto }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);

    await this.assertClassOwner({ userId, classId: data.classId });
    const refs = await this.resolveSessionRefs({
      userId,
      lessonId: data.lessonId,
      tutorId: data.tutorId,
    });
    const created = await this.repo.create({ data: { ...data, ...refs } });
    return created;
  }

  async createSessionsService({ userId, data }: { userId: string; data: CreateSessionsDto }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);

    await this.assertClassOwner({ userId, classId: data.classId });
    // resolve each distinct lesson/tutor once, not once per session
    const refCache = new Map<string, Promise<{ lessonId: string | null; tutorId: string }>>();
    const resolveRefs = (lessonId?: string | null, tutorId?: string | null) => {
      const key = `${lessonId ?? ''}|${tutorId ?? ''}`;
      let pending = refCache.get(key);
      if (!pending) {
        pending = this.resolveSessionRefs({ userId, lessonId, tutorId });
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

  async getSessionsService({ userId, query }: { userId: string; query: GetSessionsQueryDto }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);

    const result = await this.repo.getAll({ userId, query });
    return {
      ...result,
      sessions: result.sessions.map((session) =>
        this.gateExercises(session, session.class?.tutorId === userId),
      ),
    };
  }

  async getSessionsByClassService({ userId, classId }: { userId: string; classId: string }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);

    await this.assertClassOwner({ userId, classId });
    return this.repo.getByClass({ classId });
  }

  // detail read is allowed for the class tutor (owner) OR an enrolled student
  async getSessionService({ userId, id }: { userId: string; id: string }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.SESSION_ID_MUST_BE_UUID);

    const detail = await this.repo.getDetailById({ id });
    if (!detail) throw new NotFoundException(ERROR_MESSAGES.SESSION_NOT_FOUND);

    // access: class tutor (owner), an enrolled student, or a parent of an enrolled student
    const isOwner = detail.class?.tutorId === userId;
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
    id,
    data,
  }: {
    userId: string;
    id: string;
    data: UpdateSessionDto;
  }) {
    await this.loadOwnedSession({ userId, id });
    return this.repo.update({ id, data });
  }

  async delSessionService({ userId, id }: { userId: string; id: string }) {
    await this.loadOwnedSession({ userId, id });

    const deleted = await this.repo.del({ id });
    if (!deleted) throw new NotFoundException(ERROR_MESSAGES.SESSION_NOT_FOUND);

    return { id };
  }
}
