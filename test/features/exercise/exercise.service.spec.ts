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
import { ClassService } from 'src/features/class/class.service';
import { NotificationNotifier } from 'src/features/notification/notification.notifier';

// session/lesson services transitively load an ESM-only dep (uuid) via their repositories;
// this spec only needs the tokens, so swap the modules for bare classes
jest.mock('src/features/session/session.service', () => ({
  SessionService: class SessionService {},
}));
jest.mock('src/features/lesson/lesson.service', () => ({ LessonService: class LessonService {} }));
jest.mock('src/features/class/class.service', () => ({ ClassService: class ClassService {} }));

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const TUTOR_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const LESSON_ID = '55555555-5555-4555-8555-555555555555';
const EXERCISE_ID = '66666666-6666-4666-8666-666666666666';
const CLASS_ID = '77777777-7777-4777-8777-777777777777';

describe('ExerciseService', () => {
  let service: ExerciseService;
  let repo: Record<string, jest.Mock>;
  let userService: { getUserRolesByIds: jest.Mock };
  let sessionService: { getSessionService: jest.Mock };
  let lessonService: { getLessonByIdService: jest.Mock };
  let classService: { isStudentInClassService: jest.Mock };
  let notifier: { notifyUsers: jest.Mock };

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
      isParentOfStudent: jest.fn().mockResolvedValue(false),
      update: jest.fn(),
    };
    // parties hold the right roles: the tutor teaches, the student is a STUDENT
    userService = {
      getUserRolesByIds: jest.fn().mockResolvedValue([
        { id: TUTOR_ID, role: 'TUTOR' },
        { id: STUDENT_ID, role: 'STUDENT' },
      ]),
    };
    // the session's class is taught by TUTOR_ID (the grader named in `baseCreate`)
    sessionService = {
      getSessionService: jest
        .fn()
        .mockResolvedValue({ id: SESSION_ID, classId: CLASS_ID, class: { tutorId: TUTOR_ID } }),
    };
    classService = { isStudentInClassService: jest.fn().mockResolvedValue(true) };
    notifier = { notifyUsers: jest.fn().mockResolvedValue(undefined) };
    lessonService = { getLessonByIdService: jest.fn().mockResolvedValue({ id: LESSON_ID }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExerciseService,
        { provide: ExerciseRepository, useValue: repo },
        { provide: UserService, useValue: userService },
        { provide: SessionService, useValue: sessionService },
        { provide: LessonService, useValue: lessonService },
        { provide: ClassService, useValue: classService },
        { provide: NotificationNotifier, useValue: notifier },
      ],
    }).compile();

    service = module.get(ExerciseService);
  });

  describe('createExerciseService', () => {
    it('creates a SUBMITTED exercise when the acting user is the student', async () => {
      repo.create.mockResolvedValue({
        id: EXERCISE_ID,
        tutorId: 'tutor-x',
        status: 'SUBMITTED',
        answerKeyUrls: [{ name: 'k', url: 'u', key: 'k' }],
      });

      const result = await service.createExerciseService({
        userId: STUDENT_ID,
        data: baseCreate,
      });

      expect(repo.create).toHaveBeenCalledWith({
        data: { ...baseCreate, status: 'SUBMITTED' },
      });
      // a student must not receive the answer key before the exercise is graded
      expect(result).toMatchObject({ id: EXERCISE_ID, answerKeyUrls: [] });
    });

    it('allows the tutor of the exercise to create it as well', async () => {
      repo.create.mockResolvedValue({ id: EXERCISE_ID });

      await expect(
        service.createExerciseService({ userId: TUTOR_ID, data: baseCreate }),
      ).resolves.toBeDefined();
    });

    it('forbids a third party from submitting on behalf of someone else', async () => {
      await expect(
        service.createExerciseService({ userId: OTHER_ID, data: baseCreate }),
      ).rejects.toThrow(new ForbiddenException(ERROR_MESSAGES.EXERCISE_SUBMIT_NOT_ALLOWED));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('forbids one user from being both student and tutor (self-grading)', async () => {
      await expect(
        service.createExerciseService({
          userId: STUDENT_ID,
          data: { ...baseCreate, tutorId: STUDENT_ID },
        }),
      ).rejects.toThrow(new ForbiddenException(ERROR_MESSAGES.EXERCISE_SUBMIT_NOT_ALLOWED));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("forbids naming a tutor who doesn't teach the session's class", async () => {
      sessionService.getSessionService.mockResolvedValue({
        id: SESSION_ID,
        classId: CLASS_ID,
        class: { tutorId: OTHER_ID },
      });

      await expect(
        service.createExerciseService({ userId: STUDENT_ID, data: baseCreate }),
      ).rejects.toThrow(new ForbiddenException(ERROR_MESSAGES.EXERCISE_SUBMIT_NOT_ALLOWED));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects when the student or tutor does not exist', async () => {
      userService.getUserRolesByIds.mockResolvedValue([{ id: TUTOR_ID, role: 'TUTOR' }]);

      await expect(
        service.createExerciseService({ userId: STUDENT_ID, data: baseCreate }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('checks session access through SessionService and rejects a missing lesson', async () => {
      lessonService.getLessonByIdService.mockResolvedValue(null);

      await expect(
        service.createExerciseService({ userId: STUDENT_ID, data: baseCreate }),
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
        service.createExerciseService({ userId: STUDENT_ID, data: baseCreate }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('returns Conflict when the student already submitted for this session', async () => {
      repo.findByStudentSession.mockResolvedValue({ id: EXERCISE_ID });

      await expect(
        service.createExerciseService({ userId: STUDENT_ID, data: baseCreate }),
      ).rejects.toThrow(new ConflictException(ERROR_MESSAGES.EXERCISE_ALREADY_SUBMITTED));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('skips the duplicate check when there is no session', async () => {
      repo.create.mockResolvedValue({ id: EXERCISE_ID });

      await service.createExerciseService({
        userId: STUDENT_ID,
        data: { ...baseCreate, sessionId: null },
      });

      expect(repo.findByStudentSession).not.toHaveBeenCalled();
      expect(sessionService.getSessionService).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID sessionId with its label', async () => {
      await expect(
        service.createExerciseService({
          userId: STUDENT_ID,
          data: { ...baseCreate, sessionId: 'nope' },
        }),
      ).rejects.toThrow(new BadRequestException(`${ERROR_MESSAGES.ID_MUST_BE_UUID}: sessionId`));
    });
  });

  describe('getExercisesService', () => {
    it('lists exercises scoped to the acting user', async () => {
      repo.findAll.mockResolvedValue({ data: [], pagination: {} });

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
        notStatus: 'GRADED',
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
        data: { score: 8.5, comment: 'tot' },
      });

      const { data: patch } = repo.update.mock.calls[0][0];
      expect(repo.update.mock.calls[0][0].id).toBe(EXERCISE_ID);
      expect(patch).toMatchObject({ score: '8.5', comment: 'tot', status: 'GRADED' });
      expect(patch.gradedAt).toBeInstanceOf(Date);
    });

    it('notifies the student with the score after grading', async () => {
      repo.findById.mockResolvedValue({
        id: EXERCISE_ID,
        tutorId: TUTOR_ID,
        studentId: STUDENT_ID,
      });
      repo.update.mockResolvedValue({ id: EXERCISE_ID, status: 'GRADED' });

      await service.gradeExerciseService({
        userId: TUTOR_ID,
        role: 'TUTOR',
        id: EXERCISE_ID,
        data: { score: 8.5 },
      });

      expect(notifier.notifyUsers).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'TUTOR',
          senderId: TUTOR_ID,
          recipients: [STUDENT_ID],
          type: 'STUDENT',
          title: 'Bài tập đã được chấm',
          redirectUrl: '/grades',
        }),
      );
      expect(notifier.notifyUsers.mock.calls[0][0].content).toContain('8.5/10');
    });

    it('stores a null comment when none is provided', async () => {
      repo.findById.mockResolvedValue({ id: EXERCISE_ID, tutorId: TUTOR_ID });
      repo.update.mockResolvedValue({});

      await service.gradeExerciseService({
        userId: TUTOR_ID,
        id: EXERCISE_ID,
        data: { score: 10 },
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
          data: { score: 10 },
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
          data: { score: 1 },
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('student submission -> notify tutor', () => {
    const row = {
      id: EXERCISE_ID,
      tutorId: TUTOR_ID,
      studentId: STUDENT_ID,
      sessionId: SESSION_ID,
    };

    it('submit notifies the tutor with a TUTOR-type payload (no classId/studentId)', async () => {
      repo.findById.mockResolvedValue({ ...row, status: 'RESUBMIT' });
      repo.update.mockResolvedValue({ ...row, status: 'SUBMITTED' });
      (userService as Record<string, jest.Mock>).getUserByField = jest
        .fn()
        .mockResolvedValue([{ firstName: 'An', lastName: 'Nguyen' }]);
      sessionService.getSessionService.mockResolvedValue({ sessionNumber: 3 });

      await service.submitExerciseService({
        userId: STUDENT_ID,
        role: 'STUDENT',
        id: EXERCISE_ID,
        data: { exerciseUrls: [] },
      });

      const arg = notifier.notifyUsers.mock.calls[0][0];
      expect(arg).toMatchObject({
        role: 'STUDENT',
        senderId: STUDENT_ID,
        recipients: [TUTOR_ID],
        type: 'TUTOR',
        title: 'Học sinh đã nộp bài tập',
        redirectUrl: '/grades',
      });
      expect(arg.content).toContain('Nguyen An');
      expect(arg.content).toContain('Buổi 3');
      expect(arg).not.toHaveProperty('studentId');
      expect(arg).not.toHaveProperty('classId');
    });

    it('falls back to a generic name when the name lookup fails', async () => {
      repo.findById.mockResolvedValue({ ...row, status: 'SUBMITTED' });
      repo.update.mockResolvedValue(row);

      await service.submitExerciseService({
        userId: STUDENT_ID,
        role: 'STUDENT',
        id: EXERCISE_ID,
        data: { exerciseUrls: [] },
      });
      expect(notifier.notifyUsers.mock.calls[0][0].content).toContain('Một học sinh');
    });

    it('does not notify when the update fails (already graded)', async () => {
      repo.findById.mockResolvedValue({ ...row, status: 'SUBMITTED' });
      repo.update.mockResolvedValue(null);
      await expect(
        service.submitExerciseService({
          userId: STUDENT_ID,
          role: 'STUDENT',
          id: EXERCISE_ID,
          data: { exerciseUrls: [] },
        }),
      ).rejects.toThrow(BadRequestException);
      expect(notifier.notifyUsers).not.toHaveBeenCalled();
    });

    it('does not notify when an ADMIN submits on behalf of the student', async () => {
      repo.findById.mockResolvedValue({ ...row, status: 'SUBMITTED' });
      repo.update.mockResolvedValue(row);
      await service.submitExerciseService({
        userId: OTHER_ID,
        role: 'ADMIN',
        id: EXERCISE_ID,
        data: { exerciseUrls: [] },
      });
      expect(notifier.notifyUsers).not.toHaveBeenCalled();
    });

    it('does not notify when the tutor records a first submission for the student', async () => {
      repo.create.mockResolvedValue(row);
      await service.createExerciseService({
        userId: TUTOR_ID,
        role: 'TUTOR',
        data: { ...baseCreate, sessionId: undefined },
      });
      expect(notifier.notifyUsers).not.toHaveBeenCalled();
    });

    it('notifies the tutor on a first submission and on ASSIGNED -> SUBMITTED', async () => {
      repo.create.mockResolvedValue(row);
      await service.createExerciseService({
        userId: STUDENT_ID,
        role: 'STUDENT',
        data: baseCreate,
      });
      expect(notifier.notifyUsers).toHaveBeenCalledTimes(1);

      repo.findByStudentSession.mockResolvedValue({ id: EXERCISE_ID, status: 'ASSIGNED' });
      repo.update.mockResolvedValue(row);
      await service.createExerciseService({
        userId: STUDENT_ID,
        role: 'STUDENT',
        data: baseCreate,
      });
      expect(notifier.notifyUsers).toHaveBeenCalledTimes(2);
      expect(notifier.notifyUsers.mock.calls[1][0]).toMatchObject({
        type: 'TUTOR',
        recipients: [TUTOR_ID],
      });
    });
  });

  describe('requestResubmitService', () => {
    const found = {
      id: EXERCISE_ID,
      tutorId: TUTOR_ID,
      studentId: STUDENT_ID,
      sessionId: SESSION_ID,
      status: 'GRADED',
    };

    it('sets RESUBMIT (keeping files) and notifies the student', async () => {
      repo.findById.mockResolvedValue(found);
      repo.update.mockResolvedValue({ ...found, status: 'RESUBMIT' });
      sessionService.getSessionService.mockResolvedValue({ sessionNumber: 2 });

      const res = await service.requestResubmitService({
        userId: TUTOR_ID,
        role: 'TUTOR',
        id: EXERCISE_ID,
        data: { comment: 'Làm lại câu 2' },
      });

      expect(res).toMatchObject({ status: 'RESUBMIT' });
      expect(repo.update).toHaveBeenCalledWith({
        id: EXERCISE_ID,
        data: { status: 'RESUBMIT', comment: 'Làm lại câu 2' },
      });
      expect(notifier.notifyUsers).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'TUTOR',
          senderId: TUTOR_ID,
          recipients: [STUDENT_ID],
          type: 'STUDENT',
          title: 'Yêu cầu nộp lại bài tập',
          redirectUrl: '/grades',
        }),
      );
      const content = notifier.notifyUsers.mock.calls[0][0].content;
      expect(content).toContain('Buổi 2');
      expect(content).toContain('Làm lại câu 2');
    });

    it('does not touch the comment when none is given', async () => {
      repo.findById.mockResolvedValue(found);
      repo.update.mockResolvedValue({ ...found, status: 'RESUBMIT' });
      await service.requestResubmitService({
        userId: TUTOR_ID,
        role: 'TUTOR',
        id: EXERCISE_ID,
        data: {},
      });
      expect(repo.update).toHaveBeenCalledWith({ id: EXERCISE_ID, data: { status: 'RESUBMIT' } });
    });

    it('rejects an ASSIGNED (never submitted) exercise', async () => {
      repo.findById.mockResolvedValue({ ...found, status: 'ASSIGNED' });
      await expect(
        service.requestResubmitService({
          userId: TUTOR_ID,
          role: 'TUTOR',
          id: EXERCISE_ID,
          data: {},
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('forbids another tutor and the student', async () => {
      repo.findById.mockResolvedValue(found);
      for (const [userId, role] of [
        [OTHER_ID, 'TUTOR'],
        [STUDENT_ID, 'STUDENT'],
      ]) {
        await expect(
          service.requestResubmitService({ userId, role, id: EXERCISE_ID, data: {} }),
        ).rejects.toThrow(ForbiddenException);
      }
      expect(repo.update).not.toHaveBeenCalled();
      expect(notifier.notifyUsers).not.toHaveBeenCalled();
    });

    it('returns NotFound for a missing exercise or a vanished row', async () => {
      repo.findById.mockResolvedValueOnce(null);
      await expect(
        service.requestResubmitService({
          userId: TUTOR_ID,
          role: 'TUTOR',
          id: EXERCISE_ID,
          data: {},
        }),
      ).rejects.toThrow(NotFoundException);

      repo.findById.mockResolvedValueOnce(found);
      repo.update.mockResolvedValueOnce(null);
      await expect(
        service.requestResubmitService({
          userId: TUTOR_ID,
          role: 'TUTOR',
          id: EXERCISE_ID,
          data: {},
        }),
      ).rejects.toThrow(NotFoundException);
      expect(notifier.notifyUsers).not.toHaveBeenCalled();
    });
  });
});
