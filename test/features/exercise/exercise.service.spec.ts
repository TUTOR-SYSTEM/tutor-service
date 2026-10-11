import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ERROR_MESSAGES } from 'src/data/constants';
import { ExerciseService } from 'src/features/exercise/exercise.service';
import { ExerciseRepository } from 'src/features/exercise/exercise.repository';
import { UserService } from 'src/features/user/user.service';
import { SessionService } from 'src/features/session/session.service';
import { LessonService } from 'src/features/lesson/lesson.service';

// session/lesson services transitively load an ESM-only dep (uuid) via their repositories;
// this spec only needs the tokens, so swap the modules for bare classes
jest.mock('src/features/session/session.service', () => ({
  SessionService: class SessionService {},
}));
jest.mock('src/features/lesson/lesson.service', () => ({ LessonService: class LessonService {} }));

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const TUTOR_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const LESSON_ID = '55555555-5555-4555-8555-555555555555';
const EXERCISE_ID = '66666666-6666-4666-8666-666666666666';

describe('ExerciseService', () => {
  let service: ExerciseService;
  let repo: Record<string, jest.Mock>;
  let userService: { userExists: jest.Mock };
  let sessionService: { getSessionService: jest.Mock };
  let lessonService: { getLessonByIdService: jest.Mock };

  const baseCreate = {
    studentId: STUDENT_ID,
    tutorId: TUTOR_ID,
    sessionId: SESSION_ID,
    lessonId: LESSON_ID,
  };

  beforeEach(async () => {
    repo = {
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      findByStudentSession: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    };
    userService = { userExists: jest.fn().mockResolvedValue(true) };
    // the session's class is taught by TUTOR_ID (the grader named in `baseCreate`)
    sessionService = {
      getSessionService: jest
        .fn()
        .mockResolvedValue({ id: SESSION_ID, class: { tutorId: TUTOR_ID } }),
    };
    lessonService = { getLessonByIdService: jest.fn().mockResolvedValue({ id: LESSON_ID }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExerciseService,
        { provide: ExerciseRepository, useValue: repo },
        { provide: UserService, useValue: userService },
        { provide: SessionService, useValue: sessionService },
        { provide: LessonService, useValue: lessonService },
      ],
    }).compile();

    service = module.get(ExerciseService);
  });

  describe('createExerciseService', () => {
    it('creates a SUBMITTED exercise when the acting user is the student', async () => {
      repo.create.mockResolvedValue({ id: EXERCISE_ID });

      const result = await service.createExerciseService({
        userId: STUDENT_ID,
        data: baseCreate as never,
      });

      expect(repo.create).toHaveBeenCalledWith({
        data: { ...baseCreate, status: 'SUBMITTED' },
      });
      expect(result).toEqual({ id: EXERCISE_ID });
    });

    it('allows the tutor of the exercise to create it as well', async () => {
      repo.create.mockResolvedValue({ id: EXERCISE_ID });

      await expect(
        service.createExerciseService({ userId: TUTOR_ID, data: baseCreate as never }),
      ).resolves.toBeDefined();
    });

    it('forbids a third party from submitting on behalf of someone else', async () => {
      await expect(
        service.createExerciseService({ userId: OTHER_ID, data: baseCreate as never }),
      ).rejects.toThrow(new ForbiddenException(ERROR_MESSAGES.EXERCISE_SUBMIT_NOT_ALLOWED));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('forbids one user from being both student and tutor (self-grading)', async () => {
      await expect(
        service.createExerciseService({
          userId: STUDENT_ID,
          data: { ...baseCreate, tutorId: STUDENT_ID } as never,
        }),
      ).rejects.toThrow(new ForbiddenException(ERROR_MESSAGES.EXERCISE_SUBMIT_NOT_ALLOWED));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("forbids naming a tutor who doesn't teach the session's class", async () => {
      sessionService.getSessionService.mockResolvedValue({
        id: SESSION_ID,
        class: { tutorId: OTHER_ID },
      });

      await expect(
        service.createExerciseService({ userId: STUDENT_ID, data: baseCreate as never }),
      ).rejects.toThrow(new ForbiddenException(ERROR_MESSAGES.EXERCISE_SUBMIT_NOT_ALLOWED));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects when the student or tutor does not exist', async () => {
      userService.userExists.mockImplementation(async (id: string) => id !== STUDENT_ID);

      await expect(
        service.createExerciseService({ userId: STUDENT_ID, data: baseCreate as never }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('checks session access through SessionService and rejects a missing lesson', async () => {
      lessonService.getLessonByIdService.mockResolvedValue(null);

      await expect(
        service.createExerciseService({ userId: STUDENT_ID, data: baseCreate as never }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.LESSON_NOT_FOUND));
      expect(sessionService.getSessionService).toHaveBeenCalledWith({
        userId: STUDENT_ID,
        id: SESSION_ID,
      });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('propagates the session access denial', async () => {
      sessionService.getSessionService.mockRejectedValue(new NotFoundException());

      await expect(
        service.createExerciseService({ userId: STUDENT_ID, data: baseCreate as never }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('returns Conflict when the student already submitted for this session', async () => {
      repo.findByStudentSession.mockResolvedValue({ id: EXERCISE_ID });

      await expect(
        service.createExerciseService({ userId: STUDENT_ID, data: baseCreate as never }),
      ).rejects.toThrow(new ConflictException(ERROR_MESSAGES.EXERCISE_ALREADY_SUBMITTED));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('skips the duplicate check when there is no session', async () => {
      repo.create.mockResolvedValue({ id: EXERCISE_ID });

      await service.createExerciseService({
        userId: STUDENT_ID,
        data: { ...baseCreate, sessionId: null } as never,
      });

      expect(repo.findByStudentSession).not.toHaveBeenCalled();
      expect(sessionService.getSessionService).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID sessionId with its label', async () => {
      await expect(
        service.createExerciseService({
          userId: STUDENT_ID,
          data: { ...baseCreate, sessionId: 'nope' } as never,
        }),
      ).rejects.toThrow(new BadRequestException(`${ERROR_MESSAGES.ID_MUST_BE_UUID}: sessionId`));
    });
  });

  describe('getExercisesService', () => {
    it('lists exercises scoped to the acting user', async () => {
      repo.findAll.mockResolvedValue({ exercises: [], pagination: {} });

      await service.getExercisesService({ userId: STUDENT_ID, query: { page: 1 } as never });

      expect(repo.findAll).toHaveBeenCalledWith({
        userId: STUDENT_ID,
        query: { page: 1 },
      });
    });

    it('rejects a non-UUID userId', async () => {
      await expect(
        service.getExercisesService({ userId: 'x', query: {} as never }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.findAll).not.toHaveBeenCalled();
    });
  });

  describe('getExerciseService', () => {
    it('returns the exercise to its student', async () => {
      repo.findById.mockResolvedValue({
        id: EXERCISE_ID,
        studentId: STUDENT_ID,
        tutorId: TUTOR_ID,
      });

      await expect(
        service.getExerciseService({ userId: STUDENT_ID, id: EXERCISE_ID }),
      ).resolves.toMatchObject({ id: EXERCISE_ID });
    });

    it('returns the exercise to its tutor', async () => {
      repo.findById.mockResolvedValue({
        id: EXERCISE_ID,
        studentId: STUDENT_ID,
        tutorId: TUTOR_ID,
      });

      await expect(
        service.getExerciseService({ userId: TUTOR_ID, id: EXERCISE_ID }),
      ).resolves.toMatchObject({ id: EXERCISE_ID });
    });

    it('hides exercises from unrelated users as NotFound', async () => {
      repo.findById.mockResolvedValue({
        id: EXERCISE_ID,
        studentId: STUDENT_ID,
        tutorId: TUTOR_ID,
      });

      await expect(
        service.getExerciseService({ userId: OTHER_ID, id: EXERCISE_ID }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.EXERCISE_NOT_FOUND));
    });

    it('throws NotFound when the exercise is missing', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.getExerciseService({ userId: STUDENT_ID, id: EXERCISE_ID }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a non-UUID exercise id', async () => {
      await expect(service.getExerciseService({ userId: STUDENT_ID, id: 'bad' })).rejects.toThrow(
        new BadRequestException(`${ERROR_MESSAGES.ID_MUST_BE_UUID}: Exercise Id`),
      );
    });
  });

  describe('submitExerciseService (student re-submit)', () => {
    const data = { exerciseUrls: ['https://files/a.pdf'] } as never;

    it('updates the URLs and resets status to SUBMITTED', async () => {
      repo.findById.mockResolvedValue({
        id: EXERCISE_ID,
        studentId: STUDENT_ID,
        status: 'SUBMITTED',
      });
      repo.update.mockResolvedValue({ id: EXERCISE_ID });

      await service.submitExerciseService({ userId: STUDENT_ID, id: EXERCISE_ID, data });

      expect(repo.update).toHaveBeenCalledWith({
        id: EXERCISE_ID,
        data: { exerciseUrls: ['https://files/a.pdf'], status: 'SUBMITTED' },
      });
    });

    it('blocks re-submission after the exercise is graded', async () => {
      repo.findById.mockResolvedValue({ id: EXERCISE_ID, studentId: STUDENT_ID, status: 'GRADED' });

      await expect(
        service.submitExerciseService({ userId: STUDENT_ID, id: EXERCISE_ID, data }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.EXERCISE_ALREADY_GRADED));
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("forbids re-submitting someone else's exercise, even for the tutor", async () => {
      repo.findById.mockResolvedValue({
        id: EXERCISE_ID,
        studentId: STUDENT_ID,
        status: 'SUBMITTED',
      });

      await expect(
        service.submitExerciseService({ userId: TUTOR_ID, id: EXERCISE_ID, data }),
      ).rejects.toThrow(new ForbiddenException(ERROR_MESSAGES.EXERCISE_RE_SUBMIT_NOT_ALLOWED));
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('returns NotFound for a missing exercise', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.submitExerciseService({ userId: STUDENT_ID, id: EXERCISE_ID, data }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('gradeExerciseService', () => {
    it('grades as the tutor, storing the score as a string and marking GRADED', async () => {
      repo.findById.mockResolvedValue({ id: EXERCISE_ID, tutorId: TUTOR_ID });
      repo.update.mockResolvedValue({ id: EXERCISE_ID, status: 'GRADED' });

      await service.gradeExerciseService({
        userId: TUTOR_ID,
        id: EXERCISE_ID,
        data: { score: 8.5, comment: 'tot' } as never,
      });

      const { data: patch } = repo.update.mock.calls[0][0];
      expect(repo.update.mock.calls[0][0].id).toBe(EXERCISE_ID);
      expect(patch).toMatchObject({ score: '8.5', comment: 'tot', status: 'GRADED' });
      expect(patch.gradedAt).toBeInstanceOf(Date);
    });

    it('stores a null comment when none is provided', async () => {
      repo.findById.mockResolvedValue({ id: EXERCISE_ID, tutorId: TUTOR_ID });
      repo.update.mockResolvedValue({});

      await service.gradeExerciseService({
        userId: TUTOR_ID,
        id: EXERCISE_ID,
        data: { score: 10 } as never,
      });

      expect(repo.update.mock.calls[0][0].data.comment).toBeNull();
    });

    it('forbids a student from grading', async () => {
      repo.findById.mockResolvedValue({
        id: EXERCISE_ID,
        tutorId: TUTOR_ID,
        studentId: STUDENT_ID,
      });

      await expect(
        service.gradeExerciseService({
          userId: STUDENT_ID,
          id: EXERCISE_ID,
          data: { score: 10 } as never,
        }),
      ).rejects.toThrow(new ForbiddenException(ERROR_MESSAGES.EXERCISE_GRADE_NOT_ALLOWED));
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('returns NotFound when grading a missing exercise', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.gradeExerciseService({
          userId: TUTOR_ID,
          id: EXERCISE_ID,
          data: { score: 1 } as never,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
