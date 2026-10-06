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
import { checkUuidValid } from '@packages/helpers';
import { ExerciseRepository } from './exercise.repository';
import { UserService } from '../user/user.service';
import { SessionService } from '../session/session.service';
import { LessonService } from '../lesson/lesson.service';

@Injectable()
export class ExerciseService {
  private readonly logger = new Logger(ExerciseService.name);
  constructor(
    private readonly repo: ExerciseRepository,
    private readonly userService: UserService,
    private readonly sessionService: SessionService,
    private readonly lessonService: LessonService,
  ) {}

  private assertUuid(value: string | null | undefined, label: string) {
    if (!value || !checkUuidValid({ data: value })) {
      throw new BadRequestException(`${ERROR_MESSAGES.ID_MUST_BE_UUID}: ${label}`);
    }
  }

  private async assertUserExists(id: string, label: string) {
    if (!(await this.userService.userExists(id))) {
      throw new NotFoundException(`${ERROR_MESSAGES.USER_NOT_FOUND}: ${label}`);
    }
  }

  // validate the optional cross-entity FKs (session/lesson) before touching the DB
  private async resolveRefs({
    userId,
    sessionId,
    lessonId,
  }: {
    userId: string;
    sessionId?: string | null;
    lessonId?: string | null;
  }) {
    if (sessionId) {
      this.assertUuid(sessionId, 'sessionId');
      // access-checked read: throws NotFound when the user cannot reach the session
      await this.sessionService.getSessionService({ userId, id: sessionId });
    }
    if (lessonId) {
      this.assertUuid(lessonId, 'lessonId');
      const lesson = await this.lessonService.getLessonByIdService({ id: lessonId });
      if (!lesson) throw new NotFoundException(ERROR_MESSAGES.LESSON_NOT_FOUND);
    }
  }

  async createExerciseService({ userId, data }: { userId: string; data: CreateExerciseDto }) {
    this.assertUuid(userId, 'User Id');

    // the acting user must be a party to the submission (the student who nop bai, or their tutor)
    if (data.studentId !== userId && data.tutorId !== userId) {
      throw new ForbiddenException(ERROR_MESSAGES.EXERCISE_SUBMIT_NOT_ALLOWED);
    }

    await Promise.all([
      this.assertUserExists(data.tutorId, 'Tutor'),
      this.assertUserExists(data.studentId, 'Student'),
    ]);
    await this.resolveRefs({ userId, sessionId: data.sessionId, lessonId: data.lessonId });

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

  async getExercisesService({ userId, query }: { userId: string; query: getExerciseDto }) {
    this.assertUuid(userId, 'User Id');
    return this.repo.findAll({ userId, query });
  }

  async getExerciseService({ userId, id }: { userId: string; id: string }) {
    this.assertUuid(userId, 'User Id');
    this.assertUuid(id, 'Exercise Id');

    const found = await this.repo.findById({ id });
    if (!found) throw new NotFoundException(ERROR_MESSAGES.EXERCISE_NOT_FOUND);
    if (found.studentId !== userId && found.tutorId !== userId) {
      throw new NotFoundException(ERROR_MESSAGES.EXERCISE_NOT_FOUND);
    }
    return found;
  }

  // student re-submits their own work (only while it has not been graded)
  async submitExerciseService({
    userId,
    id,
    data,
  }: {
    userId: string;
    id: string;
    data: SubmitExerciseDto;
  }) {
    this.assertUuid(userId, 'User Id');
    this.assertUuid(id, 'Exercise Id');

    const found = await this.repo.findById({ id });
    if (!found) throw new NotFoundException(ERROR_MESSAGES.EXERCISE_NOT_FOUND);
    if (found.studentId !== userId) {
      throw new ForbiddenException(ERROR_MESSAGES.EXERCISE_RE_SUBMIT_NOT_ALLOWED);
    }
    if (found.status === 'GRADED') {
      throw new BadRequestException(ERROR_MESSAGES.EXERCISE_ALREADY_GRADED);
    }

    const updated = await this.repo.update({
      id,
      data: { exerciseUrls: data.exerciseUrls, status: 'SUBMITTED' },
    });
    return updated;
  }

  // tutor grades the submission
  async gradeExerciseService({
    userId,
    id,
    data,
  }: {
    userId: string;
    id: string;
    data: GradeExerciseDto;
  }) {
    this.assertUuid(userId, 'User Id');
    this.assertUuid(id, 'Exercise Id');

    const found = await this.repo.findById({ id });
    if (!found) throw new NotFoundException(ERROR_MESSAGES.EXERCISE_NOT_FOUND);
    if (found.tutorId !== userId) {
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
