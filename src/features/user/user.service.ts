import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
import { users } from 'src/database/schema';

const USER_FIELD_COLUMN_MAP = {
  id: users.id,
  email: users.email,
  username: users.username,
  phone: users.phone,
  userCode: users.userCode,
} as const;

/**
 * Read-only lookup against the shared `users` table (owned/migrated by the `USER` service —
 * this service and `USER` point at the same Postgres database). Intentionally minimal: no
 * controller, no write methods — the tutor-domain features here only ever need to confirm a
 * user/tutor/student id exists before writing a foreign key.
 */
@Injectable()
export class UserService {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: ReturnType<typeof drizzle>,
  ) {}

  async getUserByField({
    field,
    value,
  }: {
    field: keyof typeof USER_FIELD_COLUMN_MAP;
    value: string;
  }) {
    const column = USER_FIELD_COLUMN_MAP[field];
    if (!column) return [];
    return this.db.select().from(users).where(eq(column, value));
  }

  /** Cheap existence check (id only) — use instead of getUserByField when the row isn't needed. */
  async userExists(id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return !!row;
  }

  /** Role of one user, or null when the user doesn't exist (selects 2 columns, not the row). */
  async getUserRoleById(id: string) {
    const [row] = await this.db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row ?? null;
  }

  /** Bulk id → role lookup in one query (avoids a per-id round trip when validating lists). */
  async getUserRolesByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return this.db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(inArray(users.id, ids));
  }
}
