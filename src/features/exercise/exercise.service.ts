import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import type {
  CreateExerciseDto,
  GradeExerciseDto,
  RequestResubmitExerciseDto,
  SubmitExerciseDto,
  getExerciseDto,
} from '@packages/entities/exercise';
import { canActOnOwned, checkUuidValid, isAdminRole } from '@packages/helpers';
import { ExerciseRepository } from './exercise.repository';
import { UserService } from '../user/user.service';
import { SessionService } from '../session/session.service';
import { LessonService } from '../lesson/lesson.service';
import { ClassService } from '../class/class.service';
import { NotificationNotifier } from '../notification/notification.notifier';

@Injectable()
export class ExerciseService {
  private readonly logger = new Logger(ExerciseService.name);
  constructor(
    private readonly repo: ExerciseRepository,
    private readonly userService: UserService,
    private readonly sessionService: SessionService,
    private readonly lessonService: LessonService,
    private readonly classService: ClassService,
    private readonly notifier: NotificationNotifier,
  ) {}

  // answer keys are only visible to the tutor/admin until graded; a student who is asked to
  // resubmit must not read the key of the attempt they are about to redo
  private hideAnswerKey<T extends { tutorId: string; status: string; answerKeyUrls: unknown[] }>(
    item: T,
    { userId, role }: { userId: string; role?: string | null },
  ): T {
    if (isAdminRole(role) || item.tutorId === userId || item.status === 'GRADED') return item;
    return { ...item, answerKeyUrls: [] };
  }

  // grading is the tutor's job: a TUTOR who owns the row, or ADMIN. The role check stops a user
  // whose role changed (e.g. to STUDENT) from keeping grading rights through a stale tutorId.
  private canGrade({ userId, role }: { userId: string; role?: string | null }, tutorId: string) {
    if (isAdminRole(role)) return true;
    return role === 'TUTOR' && canActOnOwned({ userId, role }, tutorId);
  }

  private assertUuid(value: string | null | undefined, label: string) {
    if (!value || !checkUuidValid({ data: value })) {
      throw new BadRequestException(`${ERROR_MESSAGES.ID_MUST_BE_UUID}: ${label}`);
    }
  }

  // the parties must hold the right role: the tutor is a TUTOR/ADMIN, the student is a STUDENT
  private async assertParties(tutorId: string, studentId: string) {
    const rows = await this.userService.getUserRolesByIds([tutorId, studentId]);
    const roleById = new Map(rows.map((r) => [r.id, r.role]));
    const tutorRole = roleById.get(tutorId);
    const studentRole = roleById.get(studentId);
    if (!tutorRole) throw new NotFoundException(`${ERROR_MESSAGES.USER_NOT_FOUND}: Tutor`);
    if (!studentRole) throw new NotFoundException(`${ERROR_MESSAGES.USER_NOT_FOUND}: Student`);
    if (tutorRole !== 'TUTOR' && tutorRole !== 'ADMIN')
      throw new BadRequestException(ERROR_MESSAGES.TUTOR_NOT_FOUND);
    if (studentRole !== 'STUDENT') throw new BadRequestException(ERROR_MESSAGES.USER_NOT_A_STUDENT);
  }

  // validate the optional cross-entity FKs (session/lesson) before touching the DB
  private async resolveRefs({
    userId,
    role,
    sessionId,
    lessonId,
  }: {
    userId: string;
    role?: string | null;
    sessionId?: string | null;
    lessonId?: string | null;
  }) {
    if (sessionId) {
      this.assertUuid(sessionId, 'sessionId');
      // access-checked read: throws NotFound when the user cannot reach the session
      await this.sessionService.getSessionService({ userId, role, id: sessionId });
    }
    if (lessonId) {
      this.assertUuid(lessonId, 'lessonId');
      const lesson = await this.lessonService.getLessonByIdService({ id: lessonId });
      if (!lesson) throw new NotFoundException(ERROR_MESSAGES.LESSON_NOT_FOUND);
    }
  }

  /** Đường dẫn trang nộp/xem bài của học sinh cho một buổi. */
  private async studentExercisePath(
    userId: string,
    role: string | null | undefined,
    sessionId: string,
  ) {
    const info = await this.sessionInfo({ userId, role, sessionId });
    return info.classId ? `/classes/${info.classId}/sessions/${sessionId}/exercise` : '/grades';
  }

  /** Nhãn "Buổi X" và lớp của buổi (để dựng đường dẫn chi tiết). Không bao giờ throw. */
  private async sessionInfo({
    userId,
    role,
    sessionId,
  }: {
    userId: string;
    role?: string | null;
    sessionId?: string | null;
  }): Promise<{ label: string; classId: string | null }> {
    if (!sessionId) return { label: '', classId: null };
    try {
      const session = (await this.sessionService.getSessionService({
        userId,
        role,
        id: sessionId,
      })) as { sessionNumber?: number | null; classId?: string | null } | null;
      const n = session?.sessionNumber;
      return {
        label: n !== undefined && n !== null ? `Buổi ${n}` : '',
        classId: session?.classId ?? null,
      };
    } catch {
      return { label: '', classId: null };
    }
  }

  /** Tên hiển thị của học sinh; fallback 'Một học sinh'. Không bao giờ throw. */
  private async studentLabel(studentId: string): Promise<string> {
    try {
      const [row] = (await this.userService.getUserByField({ field: 'id', value: studentId })) as {
        firstName?: string | null;
        lastName?: string | null;
      }[];
      const name = [row?.lastName, row?.firstName].filter(Boolean).join(' ').trim();
      return name || 'Một học sinh';
    } catch {
      return 'Một học sinh';
    }
  }

  /**
   * Báo gia sư khi chính học sinh nộp bài (không gửi khi ADMIN/TUTOR ghi hộ). Lỗi chỉ warn.
   * Payload type TUTOR, không classId/studentId — notification-service kiểm gia sư dạy học sinh.
   */
  private async notifyTutorOfSubmission({
    userId,
    role,
    exercise,
  }: {
    userId: string;
    role?: string | null;
    exercise: { id: string; studentId: string; tutorId: string; sessionId: string | null };
  }) {
    try {
      if (userId !== exercise.studentId || isAdminRole(role) || role === 'TUTOR') return;
      const [name, session] = await Promise.all([
        this.studentLabel(exercise.studentId),
        this.sessionInfo({ userId, role, sessionId: exercise.sessionId }),
      ]);
      await this.notifier.notifyUsers({
        role: 'STUDENT',
        senderId: userId,
        recipients: [exercise.tutorId],
        type: 'TUTOR',
        title: 'Học sinh đã nộp bài tập',
        content: `${name} đã nộp bài tập${session.label ? ` (${session.label})` : ''}.`,
        redirectUrl:
          session.classId && exercise.sessionId
            ? `/classes/${session.classId}/sessions/${exercise.sessionId}/submissions/${exercise.id}`
            : '/grades',
      });
    } catch (error) {
      this.logger.warn(`Không gửi được thông báo nộp bài: ${(error as Error).message}`);
    }
  }

  async createExerciseService({
    userId,
    role,
    data,
  }: {
    userId: string;
    role?: string | null;
    data: CreateExerciseDto;
  }) {
    this.assertUuid(userId, 'User Id');

    // the acting user must be a party to the submission (the student who nop bai, or their
    // tutor); ADMIN may record one on either side
    if (!isAdminRole(role) && data.studentId !== userId && data.tutorId !== userId) {
      throw new ForbiddenException(ERROR_MESSAGES.EXERCISE_SUBMIT_NOT_ALLOWED);
    }
    // A user must not be both sides of a submission, otherwise they could create a row and then
    // grade it themselves (`grade` only checks `tutorId === userId`).
    if (data.studentId === data.tutorId) {
      throw new ForbiddenException(ERROR_MESSAGES.EXERCISE_SUBMIT_NOT_ALLOWED);
    }

    await this.assertParties(data.tutorId, data.studentId);

    // a student may only send work to a tutor of a class they attend. With a session the session
    // check below enforces this; without one nothing else would.
    const actorIsStudent = !isAdminRole(role) && userId === data.studentId;
    if (actorIsStudent && !data.sessionId) {
      const teaches = await this.repo.isTutorOfStudentClass({
        tutorId: data.tutorId,
        studentId: userId,
      });
      if (!teaches) throw new ForbiddenException(ERROR_MESSAGES.EXERCISE_SUBMIT_NOT_ALLOWED);
    }
    // only staff (TUTOR/ADMIN) set the issue sheet; a student's copy of issueUrls is dropped
    const isStaff = isAdminRole(role) || role === 'TUTOR';
    const payload =
      !isStaff && data.issueUrls && data.issueUrls.length > 0 ? { ...data, issueUrls: [] } : data;

    await this.resolveRefs({ userId, role, sessionId: data.sessionId, lessonId: data.lessonId });

    // The grader must be the tutor of the session's class, and the student must be enrolled in
    // that class — not whoever the caller names.
    if (data.sessionId) {
      const session = await this.sessionService.getSessionService({
        userId,
        role,
        id: data.sessionId,
      });
      if (session.class?.tutorId !== data.tutorId) {
        throw new ForbiddenException(ERROR_MESSAGES.EXERCISE_SUBMIT_NOT_ALLOWED);
      }
      const enrolled = await this.classService.isStudentInClassService({
        classId: session.classId,
        studentId: data.studentId,
      });
      if (!enrolled) throw new BadRequestException(ERROR_MESSAGES.STUDENT_NOT_IN_CLASS);
    }

    // one submission per (student, session) — resubmits go through the submit endpoint
    if (data.sessionId) {
      const existing = await this.repo.findByStudentSession({
        studentId: data.studentId,
        sessionId: data.sessionId,
      });
      if (existing) {
        // bài đã được giao (ASSIGNED, chưa nộp): học sinh nộp vào chính dòng đó
        if (existing.status === 'ASSIGNED') {
          const submitted = await this.repo.update({
            id: existing.id,
            data: {
              exerciseUrls: data.exerciseUrls ?? [],
              status: 'SUBMITTED',
            },
            notStatus: 'GRADED',
          });
          if (!submitted) throw new BadRequestException(ERROR_MESSAGES.EXERCISE_ALREADY_GRADED);
          await this.notifyTutorOfSubmission({ userId, role, exercise: submitted });
          return this.hideAnswerKey(submitted, { userId, role });
        }
        if (existing.status === 'RESUBMIT') {
          throw new ConflictException(ERROR_MESSAGES.EXERCISE_RESUBMIT_REQUIRED);
        }
        throw new ConflictException(ERROR_MESSAGES.EXERCISE_ALREADY_SUBMITTED);
      }
    }

    const created = await this.repo.create({ data: { ...payload, status: 'SUBMITTED' } });
    await this.notifyTutorOfSubmission({ userId, role, exercise: created });
    return this.hideAnswerKey(created, { userId, role });
  }

  async getExercisesService({
    userId,
    role,
    query,
  }: {
    userId: string;
    role?: string | null;
    query: getExerciseDto;
  }) {
    this.assertUuid(userId, 'User Id');
    const result = await this.repo.findAll({ userId, role, query });
    return {
      ...result,
      data: result.data.map((item) => this.hideAnswerKey(item, { userId, role })),
    };
  }

  async getExerciseService({
    userId,
    role,
    id,
  }: {
    userId: string;
    role?: string | null;
    id: string;
  }) {
    this.assertUuid(userId, 'User Id');
    this.assertUuid(id, 'Exercise Id');

    const found = await this.repo.findById({ id });
    if (!found) throw new NotFoundException(ERROR_MESSAGES.EXERCISE_NOT_FOUND);
    const isOwnerOrParty = found.studentId === userId || found.tutorId === userId;
    const isChildParent =
      !isOwnerOrParty &&
      (await this.repo.isParentOfStudent({ parentId: userId, studentId: found.studentId }));
    if (!isAdminRole(role) && !isOwnerOrParty && !isChildParent) {
      throw new NotFoundException(ERROR_MESSAGES.EXERCISE_NOT_FOUND);
    }
    return this.hideAnswerKey(found, { userId, role });
  }

  // student re-submits their own work (only while it has not been graded)
  async submitExerciseService({
    userId,
    role,
    id,
    data,
  }: {
    userId: string;
    role?: string | null;
    id: string;
    data: SubmitExerciseDto;
  }) {
    this.assertUuid(userId, 'User Id');
    this.assertUuid(id, 'Exercise Id');

    const found = await this.repo.findById({ id });
    if (!found) throw new NotFoundException(ERROR_MESSAGES.EXERCISE_NOT_FOUND);
    if (!isAdminRole(role) && found.studentId !== userId) {
      throw new ForbiddenException(ERROR_MESSAGES.EXERCISE_RE_SUBMIT_NOT_ALLOWED);
    }
    if (found.status === 'GRADED') {
      throw new BadRequestException(ERROR_MESSAGES.EXERCISE_ALREADY_GRADED);
    }

    // conditional write: a grade that lands between the read above and this update wins
    const updated = await this.repo.update({
      id,
      data: { exerciseUrls: data.exerciseUrls, status: 'SUBMITTED' },
      notStatus: 'GRADED',
    });
    if (!updated) throw new BadRequestException(ERROR_MESSAGES.EXERCISE_ALREADY_GRADED);
    await this.notifyTutorOfSubmission({ userId, role, exercise: updated });
    return this.hideAnswerKey(updated, { userId, role });
  }

  // tutor asks the student to submit again (status -> RESUBMIT, files are kept)
  async requestResubmitService({
    userId,
    role,
    id,
    data,
  }: {
    userId: string;
    role?: string | null;
    id: string;
    data: RequestResubmitExerciseDto;
  }) {
    this.assertUuid(userId, 'User Id');
    this.assertUuid(id, 'Exercise Id');

    const found = await this.repo.findById({ id });
    if (!found) throw new NotFoundException(ERROR_MESSAGES.EXERCISE_NOT_FOUND);
    if (!this.canGrade({ userId, role }, found.tutorId)) {
      throw new ForbiddenException(ERROR_MESSAGES.EXERCISE_GRADE_NOT_ALLOWED);
    }
    if (found.status === 'ASSIGNED') {
      throw new BadRequestException(ERROR_MESSAGES.EXERCISE_NOT_SUBMITTED);
    }

    const comment = data?.comment ?? null;
    const updated = await this.repo.update({
      id,
      data: { status: 'RESUBMIT', ...(comment ? { comment } : {}) },
    });
    if (!updated) throw new NotFoundException(ERROR_MESSAGES.EXERCISE_NOT_FOUND);

    try {
      const session = await this.sessionInfo({ userId, role, sessionId: found.sessionId });
      await this.notifier.notifyUsers({
        role: role ?? 'TUTOR',
        senderId: userId,
        recipients: [found.studentId],
        type: 'STUDENT',
        title: 'Yêu cầu nộp lại bài tập',
        content: `Gia sư yêu cầu bạn nộp lại bài tập${session.label ? ` (${session.label})` : ''}.${comment ? ` Nhận xét: ${comment}` : ''}`,
        redirectUrl:
          session.classId && found.sessionId
            ? `/classes/${session.classId}/sessions/${found.sessionId}/exercise`
            : '/grades',
      });
    } catch (error) {
      this.logger.warn(`Không gửi được thông báo nộp lại: ${(error as Error).message}`);
    }
    return updated;
  }

  // tutor grades the submission
  async gradeExerciseService({
    userId,
    role,
    id,
    data,
  }: {
    userId: string;
    role?: string | null;
    id: string;
    data: GradeExerciseDto;
  }) {
    this.assertUuid(userId, 'User Id');
    this.assertUuid(id, 'Exercise Id');

    const found = await this.repo.findById({ id });
    if (!found) throw new NotFoundException(ERROR_MESSAGES.EXERCISE_NOT_FOUND);
    if (!this.canGrade({ userId, role }, found.tutorId)) {
      throw new ForbiddenException(ERROR_MESSAGES.EXERCISE_GRADE_NOT_ALLOWED);
    }
    if (found.status === 'ASSIGNED') {
      throw new BadRequestException(ERROR_MESSAGES.EXERCISE_NOT_SUBMITTED);
    }

    // intentional: the assigned tutor may re-grade an already GRADED exercise to correct a score
    const graded = await this.repo.update({
      id,
      data: {
        score: String(data.score),
        comment: data.comment ?? null,
        status: 'GRADED',
        gradedAt: new Date(),
        ...(data.answerKeyUrls !== undefined ? { answerKeyUrls: data.answerKeyUrls } : {}),
      },
    });
    if (graded) {
      const score = Number(data.score);
      await this.notifier.notifyUsers({
        role,
        senderId: userId,
        recipients: [found.studentId],
        type: 'STUDENT',
        title: 'Bài tập đã được chấm',
        content: `Bài tập của bạn đã được chấm: ${Number.isFinite(score) ? score : data.score}/10.`,
        redirectUrl: found.sessionId
          ? await this.studentExercisePath(userId, role, found.sessionId)
          : '/grades',
      });
    }
    return graded;
  }

  /** Gateway gọi trước khi presign tải file: user có liên quan tới file (theo key) không. */
  async canAccessFileService({
    key,
    userId,
    role,
  }: {
    key: string;
    userId: string;
    role?: string | null;
  }): Promise<{ allowed: boolean }> {
    this.assertUuid(userId, 'User Id');
    if (!key || key.length > 512) return { allowed: false };
    const allowed = await this.repo.canAccessFile({ key, userId, role });
    return { allowed };
  }
}
