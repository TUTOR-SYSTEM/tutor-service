# Rule: Database & migrations

- **ORM**: Prisma Client. Repositories (and the few services that need a lookup) inject
  `PrismaService` from `src/database/prisma.service.ts` — a global provider exported by
  `DatabaseModule`. Never `new PrismaClient()` in `src/`; scripts use `scripts/lib/prisma.ts`.
- **RPC dates are fine, but convert anyway**: RPC payloads are JSON, so `Date` fields arrive as
  ISO strings. Prisma accepts ISO-8601 strings for `DateTime`, but the repositories still wrap
  date fields of every insert/update with `toDate()` from `@packages/helpers/date.helper` so the
  value is a real `Date` (and `null`/`undefined` pass through unchanged) — keep new code in step.
- **Schema + migrations live here**: `prisma/schema.prisma` and `prisma/migrations/`. Models are
  PascalCase singular (`ClassSession`), mapped to the existing tables with `@@map("class_sessions")`
  and to snake_case columns with `@map`. Enums are `enum X { ... @@map("x") }`. All tables use UUID
  primary keys (`@default(dbgenerated("gen_random_uuid()")) @db.Uuid`) and `created_at` /
  `updated_at` (`@updatedAt`). Back-relations must be declared on both sides.
- **To change a table/enum**: edit `prisma/schema.prisma`, run `bun run db:migrate:dev -- --name
  <change>` (creates the SQL migration), commit the new folder in `prisma/migrations/`. Apply in
  other environments with `bun run db:migrate` (`prisma migrate deploy`). Never hand-edit an
  already-applied migration (a hook blocks it) and do not run destructive DB commands
  (`migrate reset`, `db push --force-reset`, `scripts/recreate-db.ts`) automatically.
- **Baselining an existing database**: a DB created by the old drizzle-kit migrations already has
  every table. Run `bun run db:baseline` once (`prisma migrate resolve --applied 0_init`) instead
  of `db:migrate`, so `0_init` is recorded without being re-run. The only schema differences
  between the Drizzle-built DB and `0_init` are constraint/index *names* and `ON UPDATE CASCADE`
  on foreign keys.
- **The DB is shared by 4 services.** `gateway` still carries the Drizzle schema + drizzle-kit
  history, and `user` / `third-service` still query through it. Until those move too, a column
  change must be made in **both** `gateway/src/database/schema.ts` and `prisma/schema.prisma`
  (and only one of the two migration histories should be applied to a given database).
- **Query errors**: a row that must exist and doesn't makes Prisma `update`/`delete` throw `P2025`.
  Repositories that used to return `null`/`false` for "no such row" catch it with
  `isRecordNotFound(error)` (`prisma.service.ts`); for deletes prefer `deleteMany({ where })` and
  check `count > 0`. Constraint failures surface as `P2002` (unique) / `P2003` (FK) /
  `P2023` (malformed uuid) and are mapped to 409/400 by `RpcExceptionFilter` and
  `ErrorInterceptor` — check `P2002` (not just `23505`) when a service handles a duplicate itself.
- **Decimals**: `numeric` columns are `Decimal` in Prisma, not strings. Pass strings or numbers
  in; convert on the way out (`Number(row.score)`, `amount.toFixed(2)`) — see `ExerciseRepository`
  and `TuitionRepository`.
- **Json columns** (`theoryUrls`, `agenda`, ...): typed `Prisma.JsonValue` on read — cast to the
  real shape where it is consumed (see `ExerciseRepository.map`).
- **Raw SQL** (`$queryRaw` tagged templates only — every `${}` is a bound parameter): use for
  aggregates Prisma cannot express (`DashboardRepository`, the exercise average in
  `ReportRepository`, unread counts in chat). Prisma binds strings as `text`, so cast uuid params
  (`${id}::uuid`) and build `IN` lists with `uuidList(ids)`. Cast `count(*)`/enum columns
  (`::int`, `::text`, `::float8`) so the driver returns plain numbers/strings, not `BigInt`/`Decimal`.
  Never use `$queryRawUnsafe` with interpolated user input.
- **Conditional where**: build a `Prisma.XWhereInput` (or an array for `AND: [...]`) and pass it
  to both `count` and `findMany`. `undefined` entries are ignored by Prisma, so optional filters
  need no `if` branch (`{ classId, studentId, status }` with undefined values is fine). See
  `ClassRepository.getClasses` / `TuitionRepository.findAll`.
- **Pagination**: `Promise.all([count, findMany({ take, skip })])` and `buildPagination(total,
  page, limit)` from `@packages/helpers`. Query values may arrive as strings — `Number()` them.
