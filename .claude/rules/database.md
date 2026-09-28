# Rule: Database & migrations

- **2026-09-28 schema consolidation**: `src/database/schema.ts` + `drizzle.config.ts` +
  `drizzle/` no longer live in this repo — they moved to `../gateway`, which is now the
  canonical owner of the schema + migration tooling for the shared Postgres DB. This repo
  imports the table/enum definitions via the `@tutor/gateway` local package
  (`file:../gateway` dependency in `package.json`): `import * as schema from
  '@tutor/gateway/schema'` (see `src/database/database.module.ts`), and any repository that
  needs a specific table/enum imports it the same way, e.g.
  `import { classes, sessions } from '@tutor/gateway/schema'`.
- **To change a table/enum**: edit `../gateway/src/database/schema.ts`, then run
  `bun run db:generate` in `gateway` (never here — there is no local `drizzle.config.ts` or
  `drizzle-kit` dependency in this repo anymore). Tell the user to run `bun run db:migrate` (or
  `bun run db:push` for dev) from `gateway`. Do not run destructive DB commands automatically.
- All tables use UUID primary keys (`.defaultRandom()`), snake_case column names mapped from
  camelCase TS properties, and `created_at` / `updated_at` timestamps.
- Declare enums as `pgEnum('name', [...])` at the top of `schema.ts` before the tables use them.
- When a where-condition is built conditionally across `if`/`else` branches (e.g. role-based list
  scoping) rather than in one expression, annotate the accumulator explicitly as
  `let scopeWhere: SQL | undefined;` (import `type SQL` from `drizzle-orm`). An untyped `let`
  defaults to implicit `any`, which then makes any `conditions` array holding it `any[]` and
  trips `@typescript-eslint/no-unsafe-argument` the moment it's spread into `and(...conditions)`.
  See `ClassRepository.getClasses` for the reference shape.
