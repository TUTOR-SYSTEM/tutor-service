import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ERROR_MESSAGES } from 'src/data/constants';
import { AttendanceService } from 'src/features/attendance/attendance.service';
import { AttendanceRepository } from 'src/features/attendance/attendance.repository';
import { SessionService } from 'src/features/session/session.service';
import { ClassService } from 'src/features/class/class.service';

// session.service -> lesson.repository pulls an ESM-only transitive dep (uuid); the spec only
// needs the SessionService token, so swap the module for a bare class
jest.mock('src/features/session/session.service', () => ({
  SessionService: class SessionService {},
}));

const TUTOR_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TUTOR_ID = '44444444-4444-4444-8444-444444444444';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const STUDENT_A = '66666666-6666-4666-8666-666666666666';
const STUDENT_B = '77777777-7777-4777-8777-777777777777';

const roster = [
  { id: STUDENT_A, firstName: 'An', lastName: 'Nguyen', avatar: null, userCode: 'S1' },
  { id: STUDENT_B, firstName: 'Binh', lastName: 'Tran', avatar: null, userCode: 'S2' },
];

describe('AttendanceService', () => {
  let service: AttendanceService;
  let repo: { findBySession: jest.Mock; upsert: jest.Mock };
  let sessionService: { getSessionService: jest.Mock };
  let classService: { getAllStudentsService: jest.Mock };

  beforeEach(async () => {
    repo = { findBySession: jest.fn().mockResolvedValue([]), upsert: jest.fn() };
    sessionService = {
      getSessionService: jest.fn().mockResolvedValue({
        id: SESSION_ID,
        classId: CLASS_ID,
        class: { tutorId: TUTOR_ID },
      }),
    };
    classService = { getAllStudentsService: jest.fn().mockResolvedValue(roster) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: AttendanceRepository, useValue: repo },
        { provide: SessionService, useValue: sessionService },
        { provide: ClassService, useValue: classService },
      ],
    }).compile();

    service = module.get(AttendanceService);
  });

  describe('getBySessionService', () => {
    it('returns one row per roster student, defaulting absent students to not present', async () => {
      const markedAt = new Date('2026-10-01T08:00:00.000Z');
      repo.findBySession.mockResolvedValue([
        { studentId: STUDENT_A, present: true, note: 'on time', updatedAt: markedAt },
      ]);

      const rows = await service.getBySessionService({ userId: TUTOR_ID, sessionId: SESSION_ID });

      expect(rows).toEqual([
        {
          studentId: STUDENT_A,
          firstName: 'An',
          lastName: 'Nguyen',
          avatar: null,
          userCode: 'S1',
          present: true,
          note: 'on time',
          markedAt: '2026-10-01T08:00:00.000Z',
        },
        {
          studentId: STUDENT_B,
          firstName: 'Binh',
          lastName: 'Tran',
          avatar: null,
          userCode: 'S2',
          present: false,
          note: null,
          markedAt: null,
        },
      ]);
    });

    it('reads the roster of the session class, not an arbitrary one', async () => {
      await service.getBySessionService({ userId: TUTOR_ID, sessionId: SESSION_ID });

      expect(classService.getAllStudentsService).toHaveBeenCalledWith({
        userId: TUTOR_ID,
        id: CLASS_ID,
      });
      expect(repo.findBySession).toHaveBeenCalledWith({ sessionId: SESSION_ID });
    });

    it('rejects a non-UUID sessionId with the label in the message', async () => {
      await expect(
        service.getBySessionService({ userId: TUTOR_ID, sessionId: 'x' }),
      ).rejects.toThrow(new BadRequestException(`${ERROR_MESSAGES.ID_MUST_BE_UUID}: Session Id`));
      expect(sessionService.getSessionService).not.toHaveBeenCalled();
    });

    it('propagates NotFound when the caller cannot access the session', async () => {
      sessionService.getSessionService.mockRejectedValue(
        new NotFoundException(ERROR_MESSAGES.SESSION_NOT_FOUND),
      );

      await expect(
        service.getBySessionService({ userId: TUTOR_ID, sessionId: SESSION_ID }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.findBySession).not.toHaveBeenCalled();
    });
  });

  describe('upsertAttendanceService', () => {
    const data = { sessionId: SESSION_ID, studentId: STUDENT_A, present: true } as never;

    it('upserts when the acting user is the class tutor and the student is on the roster', async () => {
      repo.upsert.mockResolvedValue({ sessionId: SESSION_ID, studentId: STUDENT_A });

      const result = await service.upsertAttendanceService({ userId: TUTOR_ID, data });

      expect(repo.upsert).toHaveBeenCalledWith({ data });
      expect(result).toEqual({ sessionId: SESSION_ID, studentId: STUDENT_A });
    });

    it('forbids a user who is not the class tutor (even if they can read the session)', async () => {
      sessionService.getSessionService.mockResolvedValue({
        id: SESSION_ID,
        classId: CLASS_ID,
        class: { tutorId: OTHER_TUTOR_ID },
      });

      await expect(service.upsertAttendanceService({ userId: TUTOR_ID, data })).rejects.toThrow(
        new ForbiddenException(ERROR_MESSAGES.ATTENDANCE_MARK_NOT_ALLOWED),
      );
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('returns NotFound for a student who is not in the class roster', async () => {
      const outsider = '88888888-8888-4888-8888-888888888888';

      await expect(
        service.upsertAttendanceService({
          userId: TUTOR_ID,
          data: { sessionId: SESSION_ID, studentId: outsider, present: true } as never,
        }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.STUDENT_NOT_FOUND));
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it.each([
      ['userId', { userId: 'bad', data }, 'User Id'],
      ['sessionId', { userId: TUTOR_ID, data: { ...data, sessionId: 'bad' } }, 'sessionId'],
      ['studentId', { userId: TUTOR_ID, data: { ...data, studentId: '' } }, 'studentId'],
    ])('rejects an invalid %s before any lookup', async (_field, args, label) => {
      await expect(service.upsertAttendanceService(args as never)).rejects.toThrow(
        new BadRequestException(`${ERROR_MESSAGES.ID_MUST_BE_UUID}: ${label}`),
      );
      expect(sessionService.getSessionService).not.toHaveBeenCalled();
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('surfaces a repository failure from upsert', async () => {
      repo.upsert.mockRejectedValue(new Error('connection reset'));

      await expect(service.upsertAttendanceService({ userId: TUTOR_ID, data })).rejects.toThrow(
        'connection reset',
      );
    });
  });
});
