---
name: generate-repository
description: Scaffold the repository layer (src/features/{name}/{name}.repository.ts) — Prisma DB access via PrismaService, CRUD + paginated list using buildListWhereClause. Use when asked to create/add a repository or data-access layer for a feature in this NestJS tutoring backend.
---

# Generate Repository

Create `src/features/foo/foo.repository.ts`, mirroring `class.repository.ts`.

## Prerequisites
- The Prisma model (e.g. `Foo`) exists in `prisma/schema.prisma` and `bun run db:generate` ran.
- The DTOs exist under `@packages/entities/foo` (see `generate-entity`).

## Shape
```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, isRecordNotFound } from '../../database/prisma.service';
import { CreateFooDto, GetFoosQueryDto } from '@packages/entities/foo';
import { buildListWhereClause, buildPagination } from '@packages/helpers';

@Injectable()
export class FooRepository {
  constructor(private readonly prisma: PrismaService) {}
  // getFooByField, create, getFoos, getFoo, delFoo (+ update if needed)
}
```

## Methods (copy exact shapes from class.repository.ts)
- `getFooByField({ field, value })` → whitelist the field (`['id', 'name', 'code']`), then
  `this.prisma.foo.findFirst({ where: { [field]: value } })` (used by the service for duplicate /
  existence checks). Returns the row or `null`.
- `create({ data })` → `this.prisma.foo.create({ data: {...} })`. Map each DTO field explicitly;
  `Decimal` columns accept a string/number (`data.tuition?.toString()`).
- `getFoos({ userId, query })` → build the `where` with `buildListWhereClause({ search,
  searchFields, filters })` (returns a Prisma `where` object or `undefined`), combine with the
  ownership/relation condition in `AND: [...]`, then
  `Promise.all([count({ where }), findMany({ where, take, skip })])`. Return
  `{ foos: rows, pagination: buildPagination(total, page, limit) }` — the list key is named after
  the resource (e.g. `classes`), NOT `data`.
- `getFoo({ id })` → `findUnique({ where: { id } })`, return the row or `null`.
- `update({ id, data })` → `prisma.foo.update(...)` inside try/catch; return `null` when
  `isRecordNotFound(error)` (Prisma throws `P2025` for a missing row), rethrow otherwise.
- `delFoo({ id })` → `const { count } = await prisma.foo.deleteMany({ where: { id } }); return count > 0`.

## buildListWhereClause signature (from @packages/helpers)
```ts
const searchWhere = buildListWhereClause({
  search,
  searchFields: ['name', 'code'],
  filters: { status, subject }, // exact match; null/undefined are skipped
}) as Prisma.FooWhereInput | undefined;
const where: Prisma.FooWhereInput = { AND: [{ tutorId: userId }, ...(searchWhere ? [searchWhere] : [])] };
```

## Child-resource variants (see `schedule.repository.ts`)
A child of `class` (e.g. `schedule`) has no owner column of its own, so it skips
`buildListWhereClause` ownership and lists by parent instead:
- `createMany({ parentId, items })` → one `prisma.foo.createManyAndReturn({ data: items.map(...) })`
  multi-row insert (never a loop of single inserts).
- `getByParent({ parentId })` → `findMany({ where: { parentId }, orderBy: [...] })`.
- `getById({ id })`, `update({ id, data })`, `del({ id })` as usual.
- Access through the parent in a list: `where: { class: { OR: [{ tutorId: userId }, { students: { some: { studentId: userId } } }] } }`.

## Unit test
Put it in `test/features/{name}/{name}.repository.spec.ts`. Construct the repo directly with
`createPrismaMock()` from `test/support/prisma.mock.ts` (`prisma.foo.findMany.mockResolvedValue(...)`)
and assert the exact `where`/`data` passed. See `test/features/schedule/schedule.repository.spec.ts`
as the reference. SQL-level behaviour (raw queries, cascades) can only be checked against a real
Postgres.

## Rules
- Never inline SQL string building — reuse `buildListWhereClause`; raw SQL is `$queryRaw` tagged
  templates only, with uuid params cast (`${id}::uuid`, `uuidList(ids)`).
- Convert RPC date strings with `toDate()` on every insert/update (see `database.md`).
- Map camelCase DTO fields to columns explicitly on insert.
