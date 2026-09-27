import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type { GetLearningClassReportsQueryDto } from '@packages/entities/report';
import { ReportService } from './report.service';

/**
 * Message-pattern mirror of `ReportController` (admin-only) — reached only by the gateway's
 * `TUTOR_SERVICE` `ClientProxy` over RabbitMQ. Delegates to the
 * same, unmodified `ReportService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class ReportRpcController {
  constructor(private readonly reportService: ReportService) {}

  @MessagePattern('report.summary')
  getSummary() {
    return this.reportService.getSummary();
  }

  @MessagePattern('report.attendanceTrend')
  getAttendanceTrend() {
    return this.reportService.getAttendanceTrend();
  }

  @MessagePattern('report.classList')
  getClassList(@Payload() payload: { query: GetLearningClassReportsQueryDto }) {
    return this.reportService.getClassReports(payload.query);
  }
}