import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ERROR_MESSAGES } from 'src/data/constants';
import { SessionService } from 'src/features/session/session.service';
import { SessionRepository } from 'src/features/session/session.repository';
import { ClassService } from 'src/features/class/class.service';
import { LessonService } from 'src/features/lesson/lesson.service';
import { UserService } from 'src/features/user/user.service';

// lesson.repository pulls an ESM-only transitive dep (uuid) that jest cannot parse; the spec
// only needs the LessonService token, so replace the module with a bare class
jest.mock('src/features/lesson/lesson.service', () => ({ LessonService: class LessonService {} }));

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '44444444-4444-4444-8444-444444444444';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const LESSON_ID = '55555555-5555-4555-8555-555555555555';

describe('SessionService', () => {
  let service: SessionService;
  let repo: Record<string, jest.Mock>;
  let classService: { getOwnedClassService: jest.Mock };
  let lessonService: { getLessonByIdService: jest.Mock };
  let userService: { getUserRoleById: jest.Mock };

  beforeEach(async () => {
    repo = {
      create: jest.fn(),
      createMany: jest.fn(),
      getAll: jest.fn(),
      getByClass: jest.fn(),
      getById: jest.fn(),
      getDetailById: jest.fn(),
      isEnrolled: jest.fn().mockResolvedValue(false),
      isParentOfEnrolled: jest.fn().mockResolvedValue(false),
      update: jest.fn(),
      del: jest.fn(),
      findTakenSessionNumbers: jest.fn().mockResolvedValue([]),
    };
    // the class row carries its tutor: that is the default session tutor
    classService = {
      getOwnedClassService: jest.fn().mockResolvedValue({ id: CLASS_ID, tutorId: USER_ID }),
    };
    lessonService = { getLessonByIdService: jest.fn().mockResolvedValue({ id: LESSON_ID }) };
    userService = {
      getUserRoleById: jest.fn().mockResolvedValue({ id: OTHER_USER_ID, role: 'TUTOR' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: SessionRepository, useValue: repo },
        { provide: ClassService, useValue: classService },
        { provide: LessonService, useValue: lessonService },
        { provide: UserService, useValue: userService },
      ],
    }).compile();

    service = module.get(SessionService);
  });

  describe('createSessionService', () => {
    it('defaults tutorId to the acting user and keeps the lesson when none is given', async () => {
      repo.create.mockResolvedValue({ id: SESSION_ID });

      await service.createSessionService({
        userId: USER_ID,
        data: { classId: CLASS_ID, lessonId: LESSON_ID } as never,
      });

      expect(repo.create).toHaveBeenCalledWith({
        data: { classId: CLASS_ID, lessonId: LESSON_ID, tutorId: USER_ID },
      });
      expect(userService.getUserRoleById).not.toHaveBeenCalled();
    });

    it('validates an explicit tutorId that differs from the acting user', async () => {
      repo.create.mockResolvedValue({ id: SESSION_ID });

      await service.createSessionService({
        userId: USER_ID,
        data: { classId: CLASS_ID, tutorId: OTHER_USER_ID } as never,
      });

      expect(userService.getUserRoleById).toHaveBeenCalledWith(OTHER_USER_ID);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tutorId: OTHER_USER_ID }) }),
      );
    });

    it('rejects an explicit tutorId that is a STUDENT (not a teacher) and does not insert', async () => {
      userService.getUserRoleById.mockResolvedValue({ id: OTHER_USER_ID, role: 'STUDENT' });

      await expect(
        service.createSessionService({
          userId: USER_ID,
          data: { classId: CLASS_ID, tutorId: OTHER_USER_ID } as never,
        }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.TUTOR_NOT_FOUND));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects an explicit tutorId that does not exist', async () => {
      userService.getUserRoleById.mockResolvedValue(null);

      await expect(
        service.createSessionService({
          userId: USER_ID,
          data: { classId: CLASS_ID, tutorId: OTHER_USER_ID } as never,
        }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.TUTOR_NOT_FOUND));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects a lesson FK that does not resolve, without inserting', async () => {
      lessonService.getLessonByIdService.mockResolvedValue(null);

      await expect(
        service.createSessionService({
          userId: USER_ID,
          data: { classId: CLASS_ID, lessonId: LESSON_ID } as never,
        }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.LESSON_NOT_FOUND));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID userId', async () => {
      await expect(
        service.createSessionService({ userId: 'nope', data: { classId: CLASS_ID } as never }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID));
    });

    it('does not validate refs when the class is not owned', async () => {
      classService.getOwnedClassService.mockRejectedValue(new NotFoundException());

      await expect(
        service.createSessionService({
          userId: USER_ID,
          data: { classId: CLASS_ID, lessonId: LESSON_ID } as never,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(lessonService.getLessonByIdService).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('createSessionsService', () => {
    it('resolves each distinct lesson/tutor pair once, not once per session', async () => {
      repo.createMany.mockResolvedValue([]);

      await service.createSessionsService({
        userId: USER_ID,
        data: {
          classId: CLASS_ID,
          sessions: [
            { lessonId: LESSON_ID },
            { lessonId: LESSON_ID },
            { lessonId: LESSON_ID, tutorId: USER_ID },
          ],
        } as never,
      });

      // (LESSON_ID, undefined) and (LESSON_ID, USER_ID) are the only two distinct keys
      expect(lessonService.getLessonByIdService).toHaveBeenCalledTimes(2);
      expect(repo.createMany).toHaveBeenCalledWith(expect.objectContaining({ classId: CLASS_ID }));
      const { items } = repo.createMany.mock.calls[0][0];
      expect(items).toHaveLength(3);
      expect(items.every((i: { tutorId: string }) => i.tutorId === USER_ID)).toBe(true);
    });

    it('fails the whole batch when one lesson is missing and inserts nothing', async () => {
      lessonService.getLessonByIdService.mockResolvedValue(null);

      await expect(
        service.createSessionsService({
          userId: USER_ID,
          data: { classId: CLASS_ID, sessions: [{ lessonId: LESSON_ID }] } as never,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.createMany).not.toHaveBeenCalled();
    });
  });

  describe('getSessionsService', () => {
    it('hides exerciseUrls on sessions the acting user does not own while not completed', async () => {
      repo.getAll.mockResolvedValue({
        sessions: [
          {
            id: 'a',
            status: 'SCHEDULED',
            exerciseUrls: ['x'],
            class: { tutorId: OTHER_USER_ID },
          },
          {
            id: 'b',
            status: 'COMPLETED',
            exerciseUrls: ['y'],
            class: { tutorId: OTHER_USER_ID },
          },
          {
            id: 'c',
            status: 'SCHEDULED',
            exerciseUrls: ['z'],
            class: { tutorId: USER_ID },
          },
        ],
        pagination: { total: 3 },
      });

      const result = await service.getSessionsService({ userId: USER_ID, query: {} as never });

      expect(result.pagination).toEqual({ total: 3 });
      const byId = Object.fromEntries(result.sessions.map((s) => [s.id, s.exerciseUrls]));
      expect(byId).toEqual({ a: [], b: ['y'], c: ['z'] });
    });

    it('rejects a non-UUID userId', async () => {
      await expect(service.getSessionsService({ userId: '', query: {} as never })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getSessionService', () => {
    const detail = (status: string) => ({
      id: SESSION_ID,
      classId: CLASS_ID,
      status,
      exerciseUrls: ['https://ex/1'],
      class: { tutorId: USER_ID },
    });

    it('returns full detail to the class tutor, even before completion', async () => {
      repo.getDetailById.mockResolvedValue(detail('SCHEDULED'));

      const result = await service.getSessionService({ userId: USER_ID, id: SESSION_ID });

      expect(result.exerciseUrls).toEqual(['https://ex/1']);
    });

    it('lets an enrolled student read the session but hides exercises until COMPLETED', async () => {
      repo.getDetailById.mockResolvedValue({
        ...detail('ONGOING'),
        class: { tutorId: OTHER_USER_ID },
      });
      repo.isEnrolled.mockResolvedValue(true);

      const result = await service.getSessionService({ userId: USER_ID, id: SESSION_ID });

      expect(repo.isEnrolled).toHaveBeenCalledWith({ userId: USER_ID, classId: CLASS_ID });
      expect(result.exerciseUrls).toEqual([]);
    });

    it('shows exercises to a student once the session is COMPLETED', async () => {
      repo.getDetailById.mockResolvedValue({
        ...detail('COMPLETED'),
        class: { tutorId: OTHER_USER_ID },
      });
      repo.isEnrolled.mockResolvedValue(true);

      const result = await service.getSessionService({ userId: USER_ID, id: SESSION_ID });

      expect(result.exerciseUrls).toEqual(['https://ex/1']);
    });

    it('allows a parent of an enrolled student', async () => {
      repo.getDetailById.mockResolvedValue({
        ...detail('SCHEDULED'),
        class: { tutorId: OTHER_USER_ID },
      });
      repo.isParentOfEnrolled.mockResolvedValue(true);

      await expect(
        service.getSessionService({ userId: USER_ID, id: SESSION_ID }),
      ).resolves.toBeDefined();
      expect(repo.isParentOfEnrolled).toHaveBeenCalledWith({
        userId: USER_ID,
        classId: CLASS_ID,
      });
    });

    it('returns NotFound (not Forbidden) to an unrelated user', async () => {
      repo.getDetailById.mockResolvedValue({
        ...detail('COMPLETED'),
        class: { tutorId: OTHER_USER_ID },
      });

      await expect(service.getSessionService({ userId: USER_ID, id: SESSION_ID })).rejects.toThrow(
        new NotFoundException(ERROR_MESSAGES.SESSION_NOT_FOUND),
      );
    });

    it('rejects a non-UUID session id', async () => {
      await expect(service.getSessionService({ userId: USER_ID, id: 'bad' })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.SESSION_ID_MUST_BE_UUID),
      );
    });

    it('throws NotFound for a missing session', async () => {
      repo.getDetailById.mockResolvedValue(null);

      await expect(service.getSessionService({ userId: USER_ID, id: SESSION_ID })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateSessionService / delSessionService', () => {
    it('updates an owned session', async () => {
      repo.getById.mockResolvedValue({ id: SESSION_ID, classId: CLASS_ID });
      repo.update.mockResolvedValue({ id: SESSION_ID, status: 'COMPLETED' });

      const result = await service.updateSessionService({
        userId: USER_ID,
        id: SESSION_ID,
        data: { status: 'COMPLETED' } as never,
      });

      expect(repo.update).toHaveBeenCalledWith({
        id: SESSION_ID,
        data: { status: 'COMPLETED' },
      });
      expect(result).toEqual({ id: SESSION_ID, status: 'COMPLETED' });
    });

    it('does not update when the session is missing', async () => {
      repo.getById.mockResolvedValue(null);

      await expect(
        service.updateSessionService({ userId: USER_ID, id: SESSION_ID, data: {} as never }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.SESSION_NOT_FOUND));
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('deletes an owned session', async () => {
      repo.getById.mockResolvedValue({ id: SESSION_ID, classId: CLASS_ID });
      repo.del.mockResolvedValue(true);

      await expect(service.delSessionService({ userId: USER_ID, id: SESSION_ID })).resolves.toEqual(
        { id: SESSION_ID },
      );
    });

    it('does not delete a session the user does not own', async () => {
      repo.getById.mockResolvedValue({ id: SESSION_ID, classId: CLASS_ID });
      classService.getOwnedClassService.mockRejectedValue(new NotFoundException());

      await expect(service.delSessionService({ userId: USER_ID, id: SESSION_ID })).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.del).not.toHaveBeenCalled();
    });

    it('throws NotFound when the delete affects no rows', async () => {
      repo.getById.mockResolvedValue({ id: SESSION_ID, classId: CLASS_ID });
      repo.del.mockResolvedValue(false);

      await expect(service.delSessionService({ userId: USER_ID, id: SESSION_ID })).rejects.toThrow(
        new NotFoundException(ERROR_MESSAGES.SESSION_NOT_FOUND),
      );
    });
  });

  describe('getSessionsByClassService', () => {
    it('rejects a non-UUID userId before the ownership check', async () => {
      await expect(
        service.getSessionsByClassService({ userId: 'nope', classId: CLASS_ID }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID));
      expect(classService.getOwnedClassService).not.toHaveBeenCalled();
      expect(repo.getByClass).not.toHaveBeenCalled();
    });

    it('returns the class sessions after the ownership check passes', async () => {
      repo.getByClass.mockResolvedValue([{ id: 's1' }]);

      await expect(
        service.getSessionsByClassService({ userId: USER_ID, classId: CLASS_ID }),
      ).resolves.toEqual([{ id: 's1' }]);
      expect(classService.getOwnedClassService).toHaveBeenCalledWith({
        userId: USER_ID,
        id: CLASS_ID,
      });
    });

    it('does not read sessions when the user does not own the class', async () => {
      classService.getOwnedClassService.mockRejectedValue(
        new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND),
      );

      await expect(
        service.getSessionsByClassService({ userId: OTHER_USER_ID, classId: CLASS_ID }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND));
      expect(repo.getByClass).not.toHaveBeenCalled();
    });
  });

  describe('input guards and bulk reference cache', () => {
    it('createSessionsService rejects a non-UUID userId before resolving refs', async () => {
      await expect(
        service.createSessionsService({
          userId: 'nope',
          data: { classId: CLASS_ID, sessions: [] } as never,
        }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID));
      expect(lessonService.getLessonByIdService).not.toHaveBeenCalled();
      expect(repo.createMany).not.toHaveBeenCalled();
    });

    it('createSessionsService treats an item with neither lessonId nor tutorId as its own key', async () => {
      repo.createMany.mockResolvedValue([]);

      await service.createSessionsService({
        userId: USER_ID,
        data: { classId: CLASS_ID, sessions: [{}, {}] } as never,
      });

      expect(lessonService.getLessonByIdService).not.toHaveBeenCalled();
      expect(repo.createMany).toHaveBeenCalledTimes(1);
    });

    it('getSessionService rejects an empty userId or session id', async () => {
      await expect(service.getSessionService({ userId: '', id: SESSION_ID })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID),
      );
      await expect(service.getSessionService({ userId: USER_ID, id: '' })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.SESSION_ID_MUST_BE_UUID),
      );
      expect(repo.getDetailById).not.toHaveBeenCalled();
    });
  });

  describe('sessionNumber uniqueness within a class', () => {
    it('createSessionService rejects a sessionNumber already used in the class, without inserting', async () => {
      repo.findTakenSessionNumbers.mockResolvedValue([3]);

      await expect(
        service.createSessionService({
          userId: USER_ID,
          data: { classId: CLASS_ID, sessionNumber: 3 } as never,
        }),
      ).rejects.toThrow(new ConflictException(ERROR_MESSAGES.SESSION_NUMBER_DUPLICATE));
      expect(repo.findTakenSessionNumbers).toHaveBeenCalledWith({
        classId: CLASS_ID,
        numbers: [3],
      });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('createSessionService inserts when the sessionNumber is free in the class', async () => {
      repo.create.mockResolvedValue({ id: SESSION_ID });

      await service.createSessionService({
        userId: USER_ID,
        data: { classId: CLASS_ID, sessionNumber: 4 } as never,
      });

      expect(repo.create).toHaveBeenCalledTimes(1);
    });

    it('createSessionsService rejects two items with the same sessionNumber in one payload', async () => {
      await expect(
        service.createSessionsService({
          userId: USER_ID,
          data: {
            classId: CLASS_ID,
            sessions: [{ sessionNumber: 1 }, { sessionNumber: 2 }, { sessionNumber: 1 }],
          } as never,
        }),
      ).rejects.toThrow(new ConflictException(ERROR_MESSAGES.SESSION_NUMBER_DUPLICATE));
      expect(repo.createMany).not.toHaveBeenCalled();
    });

    it('createSessionsService rejects a batch whose sessionNumber is already stored in the class', async () => {
      repo.findTakenSessionNumbers.mockResolvedValue([2]);

      await expect(
        service.createSessionsService({
          userId: USER_ID,
          data: {
            classId: CLASS_ID,
            sessions: [{ sessionNumber: 1 }, { sessionNumber: 2 }],
          } as never,
        }),
      ).rejects.toThrow(new ConflictException(ERROR_MESSAGES.SESSION_NUMBER_DUPLICATE));
      expect(repo.findTakenSessionNumbers).toHaveBeenCalledWith({
        classId: CLASS_ID,
        numbers: [1, 2],
      });
      expect(repo.createMany).not.toHaveBeenCalled();
    });

    it('updateSessionService rejects moving a session onto a number another session holds', async () => {
      repo.getById.mockResolvedValue({ id: SESSION_ID, classId: CLASS_ID, sessionNumber: 1 });
      repo.findTakenSessionNumbers.mockResolvedValue([5]);

      await expect(
        service.updateSessionService({
          userId: USER_ID,
          id: SESSION_ID,
          data: { sessionNumber: 5 } as never,
        }),
      ).rejects.toThrow(new ConflictException(ERROR_MESSAGES.SESSION_NUMBER_DUPLICATE));
      expect(repo.findTakenSessionNumbers).toHaveBeenCalledWith({
        classId: CLASS_ID,
        numbers: [5],
        excludeId: SESSION_ID,
      });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('updateSessionService skips the check when sessionNumber is unchanged', async () => {
      repo.getById.mockResolvedValue({ id: SESSION_ID, classId: CLASS_ID, sessionNumber: 1 });
      repo.update.mockResolvedValue({ id: SESSION_ID });

      await service.updateSessionService({
        userId: USER_ID,
        id: SESSION_ID,
        data: { sessionNumber: 1 } as never,
      });

      expect(repo.findTakenSessionNumbers).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('owned-session guards', () => {
    it('updateSessionService rejects an empty userId before loading the session', async () => {
      await expect(
        service.updateSessionService({ userId: '', id: SESSION_ID, data: {} as never }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID));
      expect(repo.getDetailById).not.toHaveBeenCalled();
    });

    it('delSessionService rejects a non-UUID session id before loading the session', async () => {
      await expect(service.delSessionService({ userId: USER_ID, id: 'nope' })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.SESSION_ID_MUST_BE_UUID),
      );
      expect(repo.del).not.toHaveBeenCalled();
    });
  });
});
