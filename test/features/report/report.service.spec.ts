import { Test, TestingModule } from '@nestjs/testing';
import { ReportService } from 'src/features/report/report.service';
import { ReportRepository } from 'src/features/report/report.repository';

// report.repository pulls an ESM-only transitive dep (uuid) that jest cannot parse;
// the service only needs the repository token, so swap the module for a bare class
jest.mock('src/features/report/report.repository', () => ({
  ReportRepository: class ReportRepository {},
}));

describe('ReportService', () => {
  let service: ReportService;
  let repo: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = {
      getAllClassIds: jest.fn().mockResolvedValue(['c1', 'c2', 'c3']),
      countActiveClasses: jest.fn().mockResolvedValue(3),
      getSessionAttendance: jest.fn().mockResolvedValue({ completed: 3, resolved: 4 }),
      getGlobalSubmissionStats: jest.fn().mockResolvedValue({ submitted: 1, total: 3 }),
      getClassAggregates: jest.fn().mockResolvedValue(new Map()),
      getMonthlySessionAttendance: jest.fn(),
      getClassesTotal: jest.fn().mockResolvedValue(0),
      getClassesPage: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ReportService, { provide: ReportRepository, useValue: repo }],
    }).compile();

    service = module.get(ReportService);
  });

  describe('getSummary', () => {
    it('computes attendance and submission rates as rounded percentages', async () => {
      repo.getClassAggregates.mockResolvedValue(new Map());

      const summary = await service.getSummary();

      expect(summary).toEqual({
        activeClasses: 3,
        avgAttendanceRate: 75, // 3 / 4
        avgCurriculumProgress: 0,
        submissionRate: 33, // 1 / 3 rounded
      });
    });

    it('returns zero rates when there is nothing to resolve (no division by zero)', async () => {
      repo.getSessionAttendance.mockResolvedValue({ completed: 0, resolved: 0 });
      repo.getGlobalSubmissionStats.mockResolvedValue({ submitted: 0, total: 0 });

      const summary = await service.getSummary();

      expect(summary.avgAttendanceRate).toBe(0);
      expect(summary.submissionRate).toBe(0);
    });

    it('averages curriculum progress only over classes with progress > 0', async () => {
      repo.getClassAggregates.mockResolvedValue(
        new Map([
          ['c1', { curriculumProgress: 40 }],
          ['c2', { curriculumProgress: 0 }],
          ['c3', { curriculumProgress: 60 }],
        ]),
      );

      const summary = await service.getSummary();

      expect(summary.avgCurriculumProgress).toBe(50);
    });

    it('passes all class ids to the aggregate query', async () => {
      await service.getSummary();

      expect(repo.getClassAggregates).toHaveBeenCalledWith(['c1', 'c2', 'c3']);
    });
  });

  describe('getAttendanceTrend', () => {
    it('returns 6 month points in chronological order with MM/YYYY labels', async () => {
      repo.getMonthlySessionAttendance.mockImplementation(async (buckets: unknown[]) =>
        buckets.map(() => ({ completed: 1, resolved: 2 })),
      );

      const trend = await service.getAttendanceTrend();

      expect(trend).toHaveLength(6);
      expect(trend[5].month).toMatch(/^\d{2}\/\d{4}$/);
      // oldest bucket first, newest last: the labels must be strictly increasing by month
      const toKey = (label: string) => {
        const [mm, yyyy] = label.split('/').map(Number);
        return yyyy * 12 + mm;
      };
      const keys = trend.map((t) => toKey(t.month));
      expect(keys).toEqual([...keys].sort((a, b) => a - b));
      expect(new Set(keys).size).toBe(6);
    });

    it('reports rate 0 for a month with no resolved sessions', async () => {
      repo.getMonthlySessionAttendance.mockImplementation(async (buckets: unknown[]) =>
        buckets.map(() => ({ completed: 0, resolved: 0 })),
      );

      const trend = await service.getAttendanceTrend();

      expect(trend.every((t) => t.rate === 0)).toBe(true);
    });

    it('rounds the per-month rate', async () => {
      repo.getMonthlySessionAttendance.mockImplementation(async (buckets: unknown[]) =>
        buckets.map(() => ({ completed: 2, resolved: 3 })),
      );

      const trend = await service.getAttendanceTrend();

      expect(trend[0].rate).toBe(67);
    });
  });

  describe('getClassReports', () => {
    it('computes the offset from page/limit and returns pagination totals', async () => {
      repo.getClassesTotal.mockResolvedValue(25);
      repo.getClassesPage.mockResolvedValue([]);

      const payload = await service.getClassReports({
        page: 3,
        limit: 10,
        search: 'math',
      } as never);

      expect(repo.getClassesPage).toHaveBeenCalledWith({ search: 'math', limit: 10, offset: 20 });
      expect(payload.pagination).toEqual({ total: 25, page: 3, limit: 10, totalPages: 3 });
    });

    it('builds the display row, joining tutor name parts and defaulting missing aggregates', async () => {
      repo.getClassesTotal.mockResolvedValue(2);
      repo.getClassesPage.mockResolvedValue([
        { id: 'c1', name: 'Math', tutorFirstName: 'An', tutorLastName: 'Nguyen' },
        { id: 'c2', name: 'Physics', tutorFirstName: null, tutorLastName: null },
      ]);
      repo.getClassAggregates.mockResolvedValue(
        new Map([
          [
            'c1',
            {
              studentCount: 5,
              attendanceRate: 80,
              curriculumProgress: 40,
              assignmentsSubmitted: 3,
              assignmentsTotal: 4,
              averageScore: 8.5,
            },
          ],
        ]),
      );

      const { data } = await service.getClassReports({ page: 1, limit: 10 } as never);

      expect(data[0]).toEqual({
        classId: 'c1',
        className: 'Math',
        tutorName: 'An Nguyen',
        studentCount: 5,
        attendanceRate: 80,
        curriculumProgress: 40,
        assignmentsSubmitted: 3,
        assignmentsTotal: 4,
        averageScore: 8.5,
      });
      expect(data[1]).toEqual({
        classId: 'c2',
        className: 'Physics',
        tutorName: '—',
        studentCount: 0,
        attendanceRate: 0,
        curriculumProgress: 0,
        assignmentsSubmitted: 0,
        assignmentsTotal: 0,
        averageScore: null,
      });
    });

    it('returns totalPages 0 when there are no classes', async () => {
      const payload = await service.getClassReports({ page: 1, limit: 10 } as never);

      expect(payload.pagination.totalPages).toBe(0);
      expect(payload.data).toEqual([]);
    });
  });
});
