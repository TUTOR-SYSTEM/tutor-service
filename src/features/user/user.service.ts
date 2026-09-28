import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
import { users } from '@tutor/gateway/schema';

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
}
