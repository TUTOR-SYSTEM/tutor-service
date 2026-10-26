---
name: generate-feature
description: Scaffold a complete NestJS feature module (entity schema/dto, controller, service, repository, module) following this project's exact conventions and wire it into app.module.ts. Use when the user asks to "create a feature", "generate a feature", "add a new module/CRUD", or "scaffold" for this NestJS tutoring backend.
---

# Generate NestJS Feature

Scaffold a full feature module for this backend (an education / tutoring platform — classes,
students, schedules, sessions, curriculums, exercises, assignments, tuition, notifications)
that matches the existing **`class`** feature exactly. Use the `class` feature
(`src/features/class/*`, `src/packages/entities/class/*`) as the reference when in doubt.

## Inputs

Ask the user (or infer from the request) before generating:

1. **Feature name** — singular, lowercase (e.g. `session`). Controller route is the plural (`sessions`).
2. **Fields** — name, type, required/optional, validation (min/max/uuid/enum/url/regex).
3. Whether it needs a **Prisma model** in `prisma/schema.prisma` (usually yes for a new domain).
4. Which **sibling services** it depends on (`UserService`, `NotificationService`, …) so their
   modules get imported.

If fields are unclear, propose a sensible set and confirm before writing files.

## Composition — run the layer skills in order

This is the orchestrator. Build a feature by applying the focused per-layer skills in
dependency order (each depends on the one above):

1. **generate-db-table** — add the `pgTable`/`pgEnum` to `schema.ts`, generate migration (if a new domain).
2. **generate-entity** — Zod schema + DTOs under `src/packages/entities/{name}/`.
3. **generate-repository** — Prisma data access.
4. **generate-service** — business logic + validation.
5. **generate-controller** — routes + Swagger.
6. **generate-module** — module file + wire into `app.module.ts`.

The per-layer skills carry the detailed spec; the summary below is the shape to match. Every
owned feature here is also reachable from `gateway` over RPC — once the HTTP side is scaffolded,
add `{name}.rpc.controller.ts` via the root `add-rpc-endpoint` skill (touches both this repo and
`gateway`) unless the feature is realtime-only like `chat`.

## Naming conventions

For a feature named `foo`:

- Folder: `src/features/foo/`
- Class prefix: `Foo` → `FooController`, `FooService`, `FooRepository`, `FooModule`
- Route: `@Controller('foos')` (plural)
- Entities: `src/packages/entities/foo/` with `foo.schema.ts`, `foo.dto.ts`, `index.ts`
- Prisma model: `model Foo { ... @@map("foos") }` in `prisma/schema.prisma`
- Swagger: `src/data/swaggers/data/foo.swagger.ts` (`FOO_SWAGGERS_DATA`) +
  `src/data/swaggers/messages/foo.msg.ts` (`FOO_SWAGGER_MESSAGES`)

## Shape to match (from the `class` feature)

- **Entity** — `createFooSchema`, `updateFooSchema = createFooSchema.partial()`,
  `getFoosQuerySchema` using plain `z.coerce` pagination (NOT `z.preprocess`). Reused enums
  as `z.enum([...])`.
- **Repository** — inject `PrismaService`, methods `getFooByField`, `create`, `getFoos`
  (returns `{ foos, pagination }` — list key named after the resource), `getFoo`, `delFoo`.
  Use the object-shaped `buildListWhereClause({ search, searchableColumns, filters, filterColumns })`.
- **Service** — `Logger`, methods suffixed `...Service` (`createFooService`, `getFoosService`,
  `getFooService`, `delFooService`), validate every UUID with `checkUuidValid`, check user +
  ownership, throw `BadRequest`/`NotFound`/`Conflict`. Inject sibling feature services.
- **Controller** — `@ApiTags`, `@ApiBearerAuth('access-token')`, `@Controller('foos')`,
  `@CurrentUser()` for the acting user, `StatusCodes` from `http-status-codes` for `@HttpCode`,
  Swagger fed from the data/message files. `ZodValidationPipe` for every body/query.
- **Module** — import the modules of any injected services, `exports: [FooService]`.

## Wiring (required)

1. **`src/database/schema.ts`** — if a new table is needed, add the `pgEnum`(s) and
   `pgTable('foos', {...})` with a UUID primary key (`.defaultRandom()`), `createdAt` /
   `updatedAt` timestamps, following the style of `classes` / `users`. Then run
   `bun run db:generate` and tell the user to run `bun run db:migrate`.
2. **`src/app.module.ts`** — add `import { FooModule } from './features/foo/foo.module';`
   and insert `FooModule` into the `imports: [...]` array (near the other feature modules).

## After generating

1. Run `bun run lint:check` and `bun run build` (or `bunx tsc --noEmit`) to confirm it compiles.
2. Report exactly which files were created/modified and any migration the user must run.
3. Do NOT invent helpers — reuse `buildListWhereClause`, `checkUuidValid`, `generateCode`
   (`@packages/helpers`), `ZodValidationPipe` (`@packages/pipes`), `@CurrentUser` / `@Public` /
   `@Admin` (`@packages/decorators`) that already exist.
