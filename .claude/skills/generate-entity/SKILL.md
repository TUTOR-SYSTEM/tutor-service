---
name: generate-entity
description: Scaffold the entities layer for a domain — Zod v4 schema (create + partial update + paginated query), inferred DTOs, and index barrel — under src/packages/entities/{domain}/. Use when asked to create/add DTOs, Zod schemas, or validation for a feature in this NestJS tutoring backend.
---

# Generate Entity (Zod schema + DTO)

Create `src/packages/entities/{domain}/` for a domain named `foo`, mirroring
`src/packages/entities/class/`.

## Inputs
- Domain name (singular, lowercase), e.g. `session`.
- Fields with validation (min/max/uuid/enum/url/regex/optional/nullable/default).

## Files

### `foo.schema.ts`
Zod v4. Export:
- Shared enums first, e.g. `export const fooStatusEnum = z.enum(['OPEN', 'CLOSED']);`
- `createFooSchema = z.object({ ... })` — one rule per field, friendly messages matching
  the existing `class.schema.ts` style (e.g. `z.string({ message: 'Name is required' })`).
  Coerce numbers/dates with `z.coerce.number()` / `z.coerce.date()`; UUID FKs with
  `.uuid('Invalid tutor ID')`.
- `updateFooSchema = createFooSchema.partial()` (`.omit({ ... })` any immutable field, as
  `class.schema.ts` omits `tutorId`). **Zod 4 `.partial()` keeps `.default(...)`**, so for every
  create field that has a default, re-declare it without one:
  `.partial().omit({ ... }).extend({ status: fooStatusEnum.optional() })` — otherwise an update
  that omits the field overwrites it with the default (see `updateClassSchema` /
  `updateTuitionSchema`). Clearable dates: `z.coerce.date().nullable().optional()`.
- `getFoosQuerySchema = z.object({ ... })` — plain `z.coerce` pagination, copy the shape from
  `class.schema.ts`:
  ```ts
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().min(1).optional(),
  // + any filter fields (status enum, subject, foreign-key ids as .uuid().optional())
  ```
  Do NOT use `z.preprocess` — that was the old finance-tracker style.

### `foo.dto.ts`
```ts
import { z } from 'zod';
import { createFooSchema, getFoosQuerySchema } from './foo.schema';

export type CreateFooDto = z.infer<typeof createFooSchema>;
export type UpdateFooDto = Partial<z.infer<typeof createFooSchema>>;
export type GetFoosQueryDto = z.infer<typeof getFoosQuerySchema>;
```
Add a hand-written `FooDetailDto` type only if the detail endpoint returns computed fields
(see `ClassDetailDto` with `studentCount` / `sessionCount`).

### `index.ts`
```ts
export * from './foo.schema';
export * from './foo.dto';
```

## Rules
- Single quotes, trailing commas, 100-char width.
- Export reused enums as `z.enum([...])` (see `classStatusEnum`, `sessionFormatEnum`). The DB
  enum lives separately in `schema.ts` as `pgEnum` — keep the value lists in sync.
- Consumed by controllers via `new ZodValidationPipe<Dto>(schema)` — keep export names stable.
