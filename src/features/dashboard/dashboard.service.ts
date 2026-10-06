import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import { checkUuidValid } from '@packages/helpers';
import {
  DashboardRepository,
  type MonthlyRow,
  type TodayScheduleRow,
} from './dashboard.repository';
import { UserService } from '../user/user.service';

export interface DashboardOverview {
  role: string;
  stats: {
    classesCount: number;
    studentsCount: number;
    sessionsThisWeek: number;
    sessionsCompletedThisWeek: number;
    sessionsTodayCompleted: number;
    sessionsTodayPending: number;
    revenueThisMonth: number;
    overdueTuitionCount: number;
    unpaidTuitionAmount: number;
  };
  todaySchedule: TodayScheduleRow[];
  upcomingSchedule: TodayScheduleRow[];
  monthly: MonthlyRow[];
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly repo: DashboardRepository,
    private readonly userService: UserService,
  ) {}

  private startOfDay(d: Date) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  private endOfDay(d: Date) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  }

  // Monday as the first day of the week
  private startOfWeek(d: Date) {
    const x = this.startOfDay(d);
    const day = (x.getDay() + 6) % 7; // 0 = Monday
    x.setDate(x.getDate() - day);
    return x;
  }

  async getOverview(userId: string): Promise<DashboardOverview> {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);

    const user = await this.userService.getUserRoleById(userId);
    if (!user) throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);

    const role = user.role ?? 'STUDENT';
    const isStudent = role === 'STUDENT';

    const scope = isStudent
      ? this.repo.studentClassScope(userId)
      : this.repo.tutorClassScope(userId);

    const now = new Date();
    const weekStart = this.startOfWeek(now);
    const weekEnd = this.endOfDay(new Date(weekStart.getTime() + 6 * 86_400_000));
    const dayStart = this.startOfDay(now);
    const dayEnd = this.endOfDay(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const year = now.getFullYear();

    const tuitionStudent = isStudent ? userId : undefined;
    const [
      classesCount,
      studentsCount,
      sessionStats,
      todaySchedule,
      upcomingSchedule,
      revenueThisMonth,
      monthlyRevenue,
      monthlySessions,
      monthlyStudents,
      monthlyClasses,
      tuition,
    ] = await Promise.all([
      this.repo.countClasses(scope),
      isStudent ? Promise.resolve(0) : this.repo.countStudents(scope),
      this.repo.getSessionStats(
        scope,
        { from: weekStart, to: weekEnd },
        { from: dayStart, to: dayEnd },
      ),
      this.repo.getSchedule(scope, dayStart, dayEnd),
      this.repo.getUpcomingSchedule(scope, now, 5),
      isStudent ? Promise.resolve(0) : this.repo.getRevenue(scope, monthStart, monthEnd),
      this.repo.getMonthlyRevenue(scope, year),
      this.repo.getMonthlySessions(scope, year),
      this.repo.getNewStudentsByMonth(scope, year),
      this.repo.getNewClassesByMonth(scope, year),
      this.repo.getTuitionSums(scope, tuitionStudent),
    ]);

    const { OVERDUE: overdue, UNPAID: unpaid } = tuition;
    const unpaidTuitionAmount = isStudent ? unpaid.total + overdue.total : unpaid.total;

    let cumulativeRevenue = 0;
    const monthly: MonthlyRow[] = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const revenue = monthlyRevenue.get(m) ?? 0;
      cumulativeRevenue += revenue;
      return {
        month: m,
        revenue,
        sessions: monthlySessions.get(m) ?? 0,
        newStudents: monthlyStudents.get(m) ?? 0,
        newClasses: monthlyClasses.get(m) ?? 0,
        cumulativeRevenue,
      };
    });

    return {
      role,
      stats: {
        classesCount,
        studentsCount,
        sessionsThisWeek: sessionStats.total,
        sessionsCompletedThisWeek: sessionStats.completed,
        sessionsTodayCompleted: sessionStats.todayCompleted,
        sessionsTodayPending: sessionStats.todayPending,
        revenueThisMonth,
        overdueTuitionCount: overdue.count,
        unpaidTuitionAmount,
      },
      todaySchedule,
      upcomingSchedule,
      monthly,
    };
  }
}
