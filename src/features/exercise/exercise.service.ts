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
  SubmitExerciseDto,
  getExerciseDto,
} from '@packages/entities/exercise';
import { canActOnOwned, checkUuidValid, isAdminRole } from '@packages/helpers';
import { ExerciseRepository } from './exercise.repository';
import { UserService } from '../user/user.service';
import { SessionService } from '../session/session.service';
import { LessonService } from '../lesson/lesson.service';
import { ClassService } from '../class/class.service';

@Injectable()
export class ExerciseService {
  private readonly logger = new Logger(ExerciseService.name);
  constructor(
    private readonly repo: ExerciseRepository,
    private readonly userService: UserService,
    private readonly sessionService: SessionService,
    private readonly lessonService: LessonService,
    private readonly classService: ClassService,
  ) {}

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
        throw new ConflictException(ERROR_MESSAGES.EXERCISE_ALREADY_SUBMITTED);
      }
    }

    const created = await this.repo.create({ data: { ...data, status: 'SUBMITTED' } });
    return created;
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
    return this.repo.findAll({ userId, role, query });
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
    if (!isAdminRole(role) && found.studentId !== userId && found.tutorId !== userId) {
      throw new NotFoundException(ERROR_MESSAGES.EXERCISE_NOT_FOUND);
    }
    return found;
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
    if (!canActOnOwned({ userId, role }, found.tutorId)) {
      throw new ForbiddenException(ERROR_MESSAGES.EXERCISE_GRADE_NOT_ALLOWED);
    }

    const graded = await this.repo.update({
      id,
      data: {
        score: String(data.score),
        comment: data.comment ?? null,
        status: 'GRADED',
        gradedAt: new Date(),
      },
    });
    return graded;
  }
}
