import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type { SaveApiRouteResultDto } from '@packages/entities/api-routes';
import { ApiRoutesService } from './api-routes.service';

/** Message-pattern cho gateway (RMQ). Chỉ chuyển tiếp sang service. */
@Controller()
export class ApiRoutesRpcController {
  constructor(private readonly service: ApiRoutesService) {}

  @MessagePattern('apiRoutes.getResults')
  getResults() {
    return this.service.getResults();
  }

  @MessagePattern('apiRoutes.getCatalog')
  getCatalog() {
    return this.service.getCatalog();
  }

  @MessagePattern('apiRoutes.saveResult')
  saveResult(
    @Payload() payload: { userId: string; routeId: string; data: SaveApiRouteResultDto },
  ) {
    return this.service.saveResult(payload);
  }
}
