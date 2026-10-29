import { Controller, Get, HttpCode } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse as SwaggerResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { StatusCodes } from 'http-status-codes';
import { CurrentUser } from '@packages/decorators';
import { type JwtGuardUser } from '@packages/guards/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth('access-token')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: 'Get dashboard overview',
    description:
      'Role-aware aggregate: stats, today schedule, monthly revenue/sessions and recent notifications',
  })
  @SwaggerResponse({ status: 200, description: 'Dashboard overview fetched' })
  async overview(@CurrentUser() user: JwtGuardUser) {
    return this.dashboardService.getOverview(user.id, user.role);
  }
}
