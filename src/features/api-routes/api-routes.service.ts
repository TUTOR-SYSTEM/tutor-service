import { Injectable } from '@nestjs/common';
import type { SaveApiRouteResultDto } from '@packages/entities/api-routes';
import { ApiRoutesRepository, buildCatalog } from './api-routes.repository';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ApiRoutesService {
  constructor(
    private readonly repository: ApiRoutesRepository,
    private readonly prisma: PrismaService,
  ) {}

  getCatalog() {
    return buildCatalog(this.prisma);
  }

  getResults() {
    return this.repository.listResults();
  }

  saveResult({ userId, routeId, data }: { userId: string; routeId: string; data: SaveApiRouteResultDto }) {
    return this.repository.upsertResult(routeId, userId, data);
  }
}
