import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { SaveApiRouteResultDto } from '@packages/entities/api-routes';

export type ApiRouteResultDto = {
  routeId: string;
  status: string;
  doc: Record<string, unknown>;
  updatedBy: string | null;
  updatedAt: string;
};

@Injectable()
export class ApiRoutesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listResults(): Promise<ApiRouteResultDto[]> {
    const rows = await this.prisma.apiRouteResult.findMany({ orderBy: { routeId: 'asc' } });
    return rows.map((r) => ({
      routeId: r.routeId,
      status: r.status,
      doc: (r.doc ?? {}) as Record<string, unknown>,
      updatedBy: r.updatedBy,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async upsertResult(
    routeId: string,
    userId: string,
    data: SaveApiRouteResultDto,
  ): Promise<ApiRouteResultDto> {
    const doc = data.doc as Prisma.InputJsonValue;
    const r = await this.prisma.apiRouteResult.upsert({
      where: { routeId },
      create: { routeId, status: data.status, doc, updatedBy: userId },
      update: { status: data.status, doc, updatedBy: userId, updatedAt: new Date() },
    });
    return {
      routeId: r.routeId,
      status: r.status,
      doc: (r.doc ?? {}) as Record<string, unknown>,
      updatedBy: r.updatedBy,
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}

export type ApiCatalogDto = {
  scanId: string;
  scannedAt: string;
  commits: Record<string, string>;
  branches: Record<string, string>;
  services: Record<string, unknown>;
  sends: unknown[];
  order: string[];
  items: Record<string, unknown>[];
};

/** Dựng lại đúng hình dạng dữ liệu mà trang checklist đọc (CAT): meta + danh sách item theo thứ tự quét. */
export async function buildCatalog(prisma: PrismaService): Promise<ApiCatalogDto | null> {
  const meta = await prisma.apiCatalog.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!meta) return null;
  const rows = await prisma.apiRoute.findMany({ where: { scanId: meta.scanId } });
  const seqOf = (details: unknown) => {
    const seq = (details as Record<string, unknown> | null)?.seq;
    return typeof seq === 'number' ? seq : 0;
  };
  const items = [...rows]
    .sort((a, b) => seqOf(a.details) - seqOf(b.details))
    .map((r) => {
      const extra = { ...((r.details ?? {}) as Record<string, unknown>) };
      delete extra.seq;
      return {
        ...extra,
        id: r.id,
        key: r.key,
        svc: r.svc,
        module: r.module,
        type: r.type,
        method: r.method,
        path: r.path,
        handler: r.handler,
        file: r.file,
        line: r.line,
        auth: r.auth,
        dto: r.dto,
        dev: r.dev,
        flags: r.flags,
      };
    });
  return {
    scanId: meta.scanId,
    scannedAt: meta.scannedAt,
    commits: meta.commits as Record<string, string>,
    branches: meta.branches as Record<string, string>,
    services: meta.services as Record<string, unknown>,
    sends: meta.sends as unknown[],
    order: meta.orderList as string[],
    items,
  };
}
