import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { SaveApiRouteResultDto } from '@packages/entities/api-routes';
import { ApiRoutesRepository, buildCatalog } from './api-routes.repository';
import { PrismaService } from '../../database/prisma.service';

/** Roles allowed to write checklist results (TS-03). Exact match; anything else is refused (fail closed). */
const WRITE_ROLES: ReadonlySet<string> = new Set(['ADMIN', 'TUTOR']);
/** Roles allowed to see source file/line in the catalog (TS-03). */
const SOURCE_VIEW_ROLES: ReadonlySet<string> = new Set(['ADMIN', 'TUTOR']);
/** Upper bound on the serialized `doc` of one result (TS-03). */
const MAX_DOC_BYTES = 256 * 1024;

@Injectable()
export class ApiRoutesService {
  constructor(
    private readonly repository: ApiRoutesRepository,
    private readonly prisma: PrismaService,
  ) {}

  async getCatalog({ role }: { role?: string } = {}) {
    const catalog = await buildCatalog(this.prisma);
    if (!catalog || (role !== undefined && SOURCE_VIEW_ROLES.has(role))) return catalog;
    // Source locations stay hidden from every other role, including a missing role.
    const items = catalog.items.map((item) => {
      const rest = { ...item };
      delete rest.file;
      delete rest.line;
      return rest;
    });
    return { ...catalog, items };
  }

  getResults() {
    return this.repository.listResults();
  }

  async saveResult({
    userId,
    role,
    routeId,
    data,
  }: {
    userId: string;
    role?: string;
    routeId: string;
    data: SaveApiRouteResultDto;
  }) {
    if (role === undefined || !WRITE_ROLES.has(role)) {
      throw new ForbiddenException('FORBIDDEN_ROLE');
    }
    const size = Buffer.byteLength(JSON.stringify(data.doc ?? null) ?? 'null', 'utf8');
    if (size > MAX_DOC_BYTES) throw new BadRequestException('DOC_TOO_LARGE');
    return this.repository.upsertResult(routeId, userId, data);
  }
}
