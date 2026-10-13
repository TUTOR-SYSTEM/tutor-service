import { ForbiddenException } from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import { ReportRpcController } from 'src/features/report/report.rpc.controller';
import { ReportService } from 'src/features/report/report.service';
import { UserService } from 'src/features/user/user.service';

// regression (TUT3-01): RPC handlers skip the HTTP RolesGuard, so report.* must check the actor
jest.mock('src/features/user/user.service', () => ({ UserService: class UserService {} }));

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TUTOR_ID = '22222222-2222-4222-8222-222222222222';

describe('ReportRpcController — actor check', () => {
  let controller: ReportRpcController;
  let reportService: Record<string, jest.Mock>;
  let userService: Record<string, jest.Mock>;

  beforeEach(() => {
    reportService = {
      getSummary: jest.fn().mockResolvedValue({ activeClasses: 1 }),
      getAttendanceTrend: jest.fn().mockResolvedValue([]),
      getClassReports: jest.fn().mockResolvedValue({ classes: [] }),
    };
    userService = {
      getUserRoleById: jest.fn().mockResolvedValue({ id: ADMIN_ID, role: 'ADMIN' }),
    };
    controller = new ReportRpcController(
      reportService as unknown as ReportService,
      userService as unknown as UserService,
    );
  });

  it('serves report.summary to an ADMIN actor', async () => {
    await expect(controller.getSummary({ userId: ADMIN_ID })).resolves.toEqual({
      activeClasses: 1,
    });
    expect(userService.getUserRoleById).toHaveBeenCalledWith(ADMIN_ID);
  });

  it('rejects report.summary without a userId and never reads the report', async () => {
    await expect(controller.getSummary({})).rejects.toThrow(
      new ForbiddenException(ERROR_MESSAGES.ADMIN_ROLE_REQUIRED),
    );
    expect(reportService.getSummary).not.toHaveBeenCalled();
  });

  it('rejects a non-ADMIN actor on every report pattern', async () => {
    userService.getUserRoleById.mockResolvedValue({ id: TUTOR_ID, role: 'TUTOR' });

    await expect(controller.getSummary({ userId: TUTOR_ID })).rejects.toThrow(ForbiddenException);
    await expect(controller.getAttendanceTrend({ userId: TUTOR_ID })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(controller.getClassList({ userId: TUTOR_ID, query: {} as never })).rejects.toThrow(
      ForbiddenException,
    );
    expect(reportService.getSummary).not.toHaveBeenCalled();
    expect(reportService.getAttendanceTrend).not.toHaveBeenCalled();
    expect(reportService.getClassReports).not.toHaveBeenCalled();
  });

  it('rejects an unknown userId (no user row) as forbidden', async () => {
    userService.getUserRoleById.mockResolvedValue(null);

    await expect(controller.getSummary({ userId: ADMIN_ID })).rejects.toThrow(ForbiddenException);
  });
});
