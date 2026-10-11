---
name: generate-repository
description: Scaffold the repository layer (src/features/{name}/{name}.repository.ts) — Drizzle DB access with DRIZZLE injection, CRUD + paginated list using buildListWhereClause. Use when asked to create/add a repository or data-access layer for a feature in this NestJS tutoring backend.
---

# Generate Repository

Create `src/features/foo/foo.repository.ts`, mirroring `class.repository.ts`.

## Prerequisites
- The Drizzle table (e.g. `foos`) exists in `src/database/schema.ts`.
- The DTOs exist under `@packages/entities/foo` (see `generate-entity`).

## Shape
```ts
import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
import { CreateFooDto, GetFoosQueryDto } from '@packages/entities/foo';
import { foos } from 'src/database/schema';
import { buildListWhereClause } from '@packages/helpers';

@Injectable()
export class FooRepository {
  constructor(@Inject(DRIZZLE) private readonly db: ReturnType<typeof drizzle>) {}
  // getFooByField, create, getFoos, getFoo, delFoo (+ update if needed)
}
```

## Methods (copy exact shapes from class.repository.ts)
- `getFooByField({ field, value })` → look up a single row via a `fieldMaps` object
  (`{ id: foos.id, name: foos.name, code: foos.code }`), return the first row (used by the
  service for duplicate / existence checks).
- `create({ data })` → `.insert(foos).values({...}).returning()`, return first row. Map each
  DTO field explicitly; `.toString()` numeric/`numeric`-column values (see `tuition`).
- `getFoos({ userId, query })` → build the where with `buildListWhereClause({ search,
  searchableColumns, filters, filterColumns })` (the object-shaped signature — see below),
  AND in ownership/relation conditions, count total, then paged `.select().limit().offset()`.
  Return `{ foos: rows, pagination: { total, page, limit, totalPages } }` — the list key is
  named after the resource (e.g. `classes`), NOT `data`.
- `getFoo({ id })` → `.where(eq(foos.id, id)).limit(1)`, return the row or `[]`.
- `delFoo({ id })` → `.delete(...).returning()`, return a boolean (`!!row`).

## buildListWhereClause signature (object-shaped, from @packages/helpers)
```ts
const searchWhere = buildListWhereClause({
  search,
  searchableColumns: { name: { column: foos.name }, code: { column: foos.code } },
  filters: { status, subject },
  filterColumns: { status: { column: foos.status }, subject: { column: foos.subject } },
});
const whereClause = and(...[searchWhere, eq(foos.tutorId, userId)].filter((c) => c !== undefined));
```

## Child-resource variants (see `schedule.repository.ts`)
A child of `class` (e.g. `schedule`) has no owner column of its own, so it skips
`buildListWhereClause` and lists by parent instead:
- `createMany({ parentId, items })` → one `.insert(foos).values(items.map(...)).returning()`
  multi-row insert (never a loop of single inserts).
- `getByParent({ parentId })` → `.where(eq(foos.parentId, parentId)).orderBy(...)`, return all rows.
- `getById({ id })`, `update({ id, data })`, `del({ id })` as usual.

## Unit test
Put it in `test/features/{name}/{name}.repository.spec.ts`. Construct the repo directly with
`createDrizzleMock()` from `test/support/drizzle.mock.ts`, queue one result per awaited query
(`db.queue(rows)`), and assert filters with `renderSql(lastWhere(db))`. See
`test/features/schedule/schedule.repository.spec.ts` as the reference.

## Rules
- Never inline SQL string building — reuse `buildListWhereClause` from `@packages/helpers`.
- Convert RPC date strings with `toDate()` on every insert/update (see `database.md`).
- Map camelCase DTO fields to columns explicitly on insert; stringify `numeric` columns.
