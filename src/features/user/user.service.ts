import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

const USER_LOOKUP_FIELDS = ['id', 'email', 'username', 'phone', 'userCode'] as const;

/**
 * Read-only lookup against the shared `users` table (owned/migrated by the `USER` service —
 * this service and `USER` point at the same Postgres database). Intentionally minimal: no
 * controller, no write methods — the tutor-domain features here only ever need to confirm a
 * user/tutor/student id exists before writing a foreign key.
 */
@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserByField({
    field,
    value,
  }: {
    field: (typeof USER_LOOKUP_FIELDS)[number];
    value: string;
  }) {
    if (!USER_LOOKUP_FIELDS.includes(field)) return [];
    return this.prisma.user.findMany({ where: { [field]: value } });
  }

  /** Cheap existence check (id only) — use instead of getUserByField when the row isn't needed. */
  async userExists(id: string): Promise<boolean> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    return !!row;
  }

  /** Role of one user, or null when the user doesn't exist (selects 2 columns, not the row). */
  async getUserRoleById(id: string) {
    return this.prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  }

  /** Bulk id → role lookup in one query (avoids a per-id round trip when validating lists). */
  async getUserRolesByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, role: true },
    });
  }
}
