import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { DashboardService } from './dashboard.service';

/**
 * Message-pattern mirror of `DashboardController` — reached only by the gateway's `TUTOR_SERVICE`
 * `ClientProxy` over RabbitMQ. Delegates to the same, unmodified
 * `DashboardService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class DashboardRpcController {
  constructor(private readonly dashboardService: DashboardService) {}

  @MessagePattern('dashboard.overview')
  overview(@Payload() payload: { userId: string }) {
    return this.dashboardService.getOverview(payload.userId);
  }
}
