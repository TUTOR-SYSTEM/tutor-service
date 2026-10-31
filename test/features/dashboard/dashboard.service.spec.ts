import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ERROR_MESSAGES } from 'src/data/constants';
import { DashboardService } from 'src/features/dashboard/dashboard.service';
import { DashboardRepository } from 'src/features/dashboard/dashboard.repository';
import { UserService } from 'src/features/user/user.service';
import { RmqProducer } from 'src/features/rabbitmq/rmq.producer';

// dashboard.repository pulls an ESM-only transitive dep (uuid) that jest cannot
// parse; the service only needs the repository token, so swap the module for a bare class
jest.mock('src/features/dashboard/dashboard.repository', () => ({
  DashboardRepository: class DashboardRepository {},
}));

const USER_ID = '11111111-1111-4111-8111-111111111111';

const zeroMap = () => new Map<number, number>();

describe('DashboardService', () => {
  let service: DashboardService;
  let repo: Record<string, jest.Mock>;
  let user: { getUserRoleById: jest.Mock };
  let rmq: { send: jest.Mock };

  beforeEach(async () => {
    repo = {
      studentClassScope: jest.fn().mockReturnValue('STUDENT_SCOPE'),
      tutorClassScope: jest.fn().mockReturnValue('TUTOR_SCOPE'),
      countClasses: jest.fn().mockResolvedValue(3),
      countStudents: jest.fn().mockResolvedValue(12),
      getSessionStats: jest.fn().mockResolvedValue({
        total: 8,
        completed: 5,
        todayCompleted: 1,
        todayPending: 2,
      }),
      getSchedule: jest.fn().mockResolvedValue([{ id: 'today' }]),
      getUpcomingSchedule: jest.fn().mockResolvedValue([{ id: 'next' }]),
      getRevenue: jest.fn().mockResolvedValue(900),
      getMonthlyRevenue: jest.fn().mockResolvedValue(
        new Map([
          [1, 100],
          [2, 250],
        ]),
      ),
      getMonthlySessions: jest.fn().mockResolvedValue(new Map([[1, 4]])),
      getNewStudentsByMonth: jest.fn().mockResolvedValue(zeroMap()),
      getNewClassesByMonth: jest.fn().mockResolvedValue(zeroMap()),
      getTuitionSums: jest.fn().mockResolvedValue({
        OVERDUE: { count: 2, total: 300 },
        UNPAID: { count: 1, total: 150 },
      }),
    };
    user = { getUserRoleById: jest.fn().mockResolvedValue({ id: USER_ID, role: 'TUTOR' }) };
    rmq = { send: jest.fn().mockResolvedValue({ data: [{ id: 'n1' }], pagination: {} }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: DashboardRepository, useValue: repo },
        { provide: UserService, useValue: user },
        { provide: RmqProducer, useValue: rmq },
      ],
    }).compile();

    service = module.get(DashboardService);
  });

  it('rejects a non-UUID user id before any query', async () => {
    await expect(service.getOverview('nope')).rejects.toThrow(
      new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID),
    );
    expect(user.getUserRoleById).not.toHaveBeenCalled();
  });

  it('returns NotFound when the user does not exist', async () => {
    user.getUserRoleById.mockResolvedValue(null);

    await expect(service.getOverview(USER_ID)).rejects.toThrow(
      new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND),
    );
  });

  describe('tutor overview', () => {
    it('uses the tutor class scope and counts students', async () => {
      const result = await service.getOverview(USER_ID);

      expect(repo.tutorClassScope).toHaveBeenCalledWith(USER_ID);
      expect(repo.studentClassScope).not.toHaveBeenCalled();
      expect(repo.countStudents).toHaveBeenCalledWith('TUTOR_SCOPE');
      expect(result.role).toBe('TUTOR');
      expect(result.stats).toMatchObject({
        classesCount: 3,
        studentsCount: 12,
        sessionsThisWeek: 8,
        sessionsCompletedThisWeek: 5,
        sessionsTodayCompleted: 1,
        sessionsTodayPending: 2,
        revenueThisMonth: 900,
      });
    });

    it('sums overdue and unpaid tuition as unpaid amount (tutor view = unpaid only)', async () => {
      const result = await service.getOverview(USER_ID);

      expect(result.stats.overdueTuitionCount).toBe(2);
      expect(result.stats.unpaidTuitionAmount).toBe(150);
      expect(repo.getTuitionSums).toHaveBeenCalledWith('TUTOR_SCOPE', undefined);
    });

    it('returns today and upcoming schedules from the repository', async () => {
      const result = await service.getOverview(USER_ID);

      expect(result.todaySchedule).toEqual([{ id: 'today' }]);
      expect(result.upcomingSchedule).toEqual([{ id: 'next' }]);
      expect(repo.getUpcomingSchedule).toHaveBeenCalledWith('TUTOR_SCOPE', expect.any(Date), 5);
    });

    it('attaches recent notifications from third-service (best-effort, no retries)', async () => {
      const result = await service.getOverview(USER_ID);

      expect(rmq.send).toHaveBeenCalledWith(
        'notification.getAll',
        { userId: USER_ID, query: { page: 1, limit: 5 } },
        5000,
        0,
      );
      expect(result.recentNotifications).toEqual([{ id: 'n1' }]);
    });

    it('returns an empty notification list instead of failing when third-service is down', async () => {
      rmq.send.mockRejectedValueOnce(new Error('broker unavailable'));

      const result = await service.getOverview(USER_ID);

      expect(result.recentNotifications).toEqual([]);
      expect(result.todaySchedule).toEqual([{ id: 'today' }]);
    });
  });

  describe('role resolution', () => {
    it('uses the role the gateway forwarded from the JWT and skips the role query', async () => {
      user.getUserRoleById.mockResolvedValue({ id: USER_ID, role: 'TUTOR' });

      await service.getOverview(USER_ID, 'STUDENT');

      expect(user.getUserRoleById).not.toHaveBeenCalled();
      expect(repo.studentClassScope).toHaveBeenCalledWith(USER_ID);
    });

    it('looks the role up when the caller does not pass one', async () => {
      await service.getOverview(USER_ID);

      expect(user.getUserRoleById).toHaveBeenCalledWith(USER_ID);
    });
  });

  describe('student overview', () => {
    beforeEach(() => {
      user.getUserRoleById.mockResolvedValue({ id: USER_ID, role: 'STUDENT' });
    });

    it('uses the student class scope and skips tutor-only aggregates', async () => {
      const result = await service.getOverview(USER_ID);

      expect(repo.studentClassScope).toHaveBeenCalledWith(USER_ID);
      expect(repo.countStudents).not.toHaveBeenCalled();
      expect(repo.getRevenue).not.toHaveBeenCalled();
      expect(result.stats.studentsCount).toBe(0);
      expect(result.stats.revenueThisMonth).toBe(0);
    });

    it('scopes tuition to the student and counts both overdue and unpaid as owed', async () => {
      const result = await service.getOverview(USER_ID);

      expect(repo.getTuitionSums).toHaveBeenCalledWith('STUDENT_SCOPE', USER_ID);
      expect(result.stats.unpaidTuitionAmount).toBe(450);
    });
  });

  it('defaults a missing role to STUDENT', async () => {
    user.getUserRoleById.mockResolvedValue({ id: USER_ID, role: null });

    const result = await service.getOverview(USER_ID);

    expect(result.role).toBe('STUDENT');
    expect(repo.studentClassScope).toHaveBeenCalled();
  });

  describe('monthly series', () => {
    it('always returns 12 months with zero-filled gaps and a running cumulative revenue', async () => {
      const { monthly } = await service.getOverview(USER_ID);

      expect(monthly).toHaveLength(12);
      expect(monthly.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect(monthly[0]).toEqual({
        month: 1,
        revenue: 100,
        sessions: 4,
        newStudents: 0,
        newClasses: 0,
        cumulativeRevenue: 100,
      });
      expect(monthly[1]).toMatchObject({
        month: 2,
        revenue: 250,
        sessions: 0,
        cumulativeRevenue: 350,
      });
      expect(monthly[11]).toMatchObject({ month: 12, revenue: 0, cumulativeRevenue: 350 });
    });
  });
});
