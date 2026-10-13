import { Controller, ForbiddenException } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type { GetLearningClassReportsQueryDto } from '@packages/entities/report';
import { checkUuidValid } from '@packages/helpers';
import { ERROR_MESSAGES } from 'src/data/constants';
import { UserService } from '../user/user.service';
import { ReportService } from './report.service';

/**
 * Message-pattern mirror of `ReportController` (admin-only) — reached only by the gateway's
 * `TUTOR_SERVICE` `ClientProxy` over RabbitMQ. Delegates to the same, unmodified `ReportService`
 * the HTTP controller uses; no business logic lives here.
 *
 * RPC handlers do not run the HTTP JwtAuthGuard/RolesGuard, so the acting user is checked here:
 * the payload must carry `userId` and that user's role in `users` must be ADMIN (fail closed).
 */
@Controller()
export class ReportRpcController {
  constructor(
    private readonly reportService: ReportService,
    private readonly userService: UserService,
  ) {}

  private async assertAdminActor(payload: { userId?: string } | undefined) {
    const userId = payload?.userId;
    if (!userId || !checkUuidValid({ data: userId }))
      throw new ForbiddenException(ERROR_MESSAGES.ADMIN_ROLE_REQUIRED);
    const actor = await this.userService.getUserRoleById(userId);
    if (actor?.role !== 'ADMIN') throw new ForbiddenException(ERROR_MESSAGES.ADMIN_ROLE_REQUIRED);
  }

  @MessagePattern('report.summary')
  async getSummary(@Payload() payload: { userId?: string }) {
    await this.assertAdminActor(payload);
    return this.reportService.getSummary();
  }

  @MessagePattern('report.attendanceTrend')
  async getAttendanceTrend(@Payload() payload: { userId?: string }) {
    await this.assertAdminActor(payload);
    return this.reportService.getAttendanceTrend();
  }

  @MessagePattern('report.classList')
  async getClassList(
    @Payload() payload: { userId?: string; query: GetLearningClassReportsQueryDto },
  ) {
    await this.assertAdminActor(payload);
    return this.reportService.getClassReports(payload.query);
  }
}
