# CLAUDE.md — tutor-service

## Project Overview

**Education-domain** microservice of a tutoring-platform backend split into 4 independent
NestJS services: `gateway` (HTTP-facing), `user` (auth/user/admin/student), `tutor-service`
(this repo — classes, scheduling, curriculum), `third-service` (notification/email/upload).
Built with **NestJS 11** + **TypeScript**, **PostgreSQL** (Drizzle ORM), no HTTP traffic from
end users directly — reached only via `gateway`, over RPC (see "RPC status" below).

This repo previously described a personal-finance app ("My Finance Tracker" —
categories/wallets/transactions); that domain is gone. The `.claude/rules/*.md` files were
already kept in sync with the real domain — this `CLAUDE.md` was not, until now.

## IMPORTANT: Selective File Reading

**Do NOT read entire source code.** Only read files necessary for the current task:

### When working on a feature:
1. Read `CLAUDE.md` and `.claude/rules/*.md` for conventions
2. Read the specific feature module: `src/features/{name}/*`
3. Read related entities: `src/packages/entities/{name}/*`
4. Read database schema only if modifying tables: `src/database/schema.ts`
5. Read `app.module.ts` only when registering new modules

### When fixing a bug:
1. Read the specific file with the bug
2. Read related files only if needed for context
3. Do NOT read unrelated features

### When adding a new feature:
1. Use `generate-*` skills first (they encode the patterns)
2. Read only the reference feature mentioned in the skill (`class` is canonical — see
   `.claude/rules/nestjs-feature-pattern.md`)
3. Read `src/app.module.ts` to register the new module

### Files to read ONLY when necessary:
- `src/main.ts` — Only when changing bootstrap or the RMQ listener setup
- `src/app.module.ts` — Only when adding/removing modules
- `src/database/schema.ts` — Only when modifying database schema
- `src/packages/helpers/*` — Only when using specific helpers
- `src/data/constants/*` — Only when adding error/success messages

## Tech Stack

| Layer            | Technology                                              |
| ---------------- | --------------------------------------------------------- |
| Framework        | NestJS 11                                                |
| Language         | TypeScript 5 (strictNullChecks only)                     |
| Database         | PostgreSQL via Drizzle ORM (`postgres.js`/`pg` drivers)  |
| Inter-service    | RabbitMQ — `@nestjs/microservices` RMQ listener on `tutor_queue` is wired up in `main.ts` and every feature except `chat`/`user` has a `{name}.rpc.controller.ts` responder (12 features — see architecture.md) |
| Authentication   | Passport JWT (access + refresh), same secrets as `gateway`/`user` |
| Validation       | Zod v4 (via custom `ZodValidationPipe`)                  |
| API Docs         | @nestjs/swagger (note: title/description in `main.ts` still say "financial management system" — stale, harmless) |
| Package Manager  | Bun (runtime) / npm (lock file present)                  |
| Testing          | Jest (unit + e2e) + Supertest — **not** a separate Bun-native runner |
| Formatting       | Prettier (single quotes, trailing commas)                |
| Linting          | ESLint + typescript-eslint                               |
| Containerization | Docker Compose / Podman Compose (Postgres + Redis — Redis container runs but nothing in this repo currently connects to it) |

`package.json` also lists `@aws-sdk/*`, `cloudinary`, `sharp`, `nodemailer`, `resend`,
`ioredis`, `socket.io` — **none of these are imported anywhere in `src/`** (verified via grep).
They're leftover from the shared template this repo was split from; don't treat their presence
as evidence a feature uses email/uploads/Redis/websockets — check actual imports.

## Commands

```bash
# Development
bun start:dev             # Start dev server with watch
bun start:debug           # Start with debug + watch
bun run build             # Production build
bun run start:prod        # Run compiled JS

# Code Quality
bun run lint              # ESLint with --fix
bun run lint:check        # ESLint without fix (CI-friendly)
bun run format             # Prettier write
bun run format:check      # Prettier check

# Testing
bun run test              # Unit tests (Jest)
bun run test:watch        # Unit tests in watch mode
bun run test:cov          # Unit tests with coverage
bun run test:e2e          # E2E tests
bun run test:debug        # Debug tests with inspect

# Database (Drizzle)
bun run db:generate       # Generate migration SQL from schema changes
bun run db:migrate        # Run pending migrations
bun run db:push           # Push schema directly (dev only)
bun run db:studio         # Open Drizzle Studio

# Database Seeds (scripts/*.ts, Bun runtime)
bun run db:seed:user / users-bulk / categories / grades / wallet / edu-flow / dashboard / curriculum-demo
# Note: seed:categories and seed:wallet are leftovers from the finance-tracker era —
# the categories/wallet tables no longer exist in schema.ts (see below); running them will fail.

# Containers (Postgres + Redis)
bun compose:up / compose:down
bun podman:up / podman:down / podman:logs
```

## Project Structure

```
src/
├── main.ts                       # Bootstrap: CORS, interceptors, filters, RMQ listener (tutor_queue), listen
├── app.module.ts                 # Root module (imports all feature modules)
├── app.controller.ts / app.service.ts   # Health-check
├── database/
│   ├── database.module.ts        # Global Drizzle ORM provider (postgres.js)
│   └── schema.ts                 # Real tables: users, grades, classes, class_students, schedules,
│                                  # class_sessions, curriculums, chapters, lessons, tuitions,
│                                  # notifications, student_scores, ai_messages, attendances,
│                                  # exercises, conversations, conversation_participants, messages
│                                  # (categories/wallets/transactions are commented out — dead code
│                                  # left in the file, not live tables)
├── features/                     # class, schedule, session, curriculum, chapter, lesson, tuition,
│                                  # exercise, attendance, chat, report, dashboard, agents, user
└── packages/                     # Shared utilities (import via @packages/*)
    ├── configs/ decorators/ entities/ filters/ guards/ helpers/ interceptor/ interfaces/
    │   pipes/ strategy/  — same shape as `user`/`gateway`
```

## Code Conventions

See `.claude/rules/conventions.md` and `.claude/rules/nestjs-feature-pattern.md` — those are
accurate and detailed (class-feature layering, child-resource authorization, RPC responders,
etc.). Summary: `@packages/*` alias, Zod v4 validation via `ZodValidationPipe`, JWT auth
with `@Public()`/`@Roles('ADMIN')`, `ERROR_MESSAGES`/`SUCCESS_MESSAGES` constants, Prettier
single-quote/100-width style enforced by a PostToolUse hook.

### Request/Response Flow

1. Request → Global `JwtAuthGuard` (unless `@Public()`)
2. Controller validates body via `ZodValidationPipe` (Zod schema)
3. Service → Repository → Drizzle ORM → PostgreSQL
4. `ResponseInterceptor` wraps the response:
   ```json
   { "statusCode": 200, "message": "Success", "data": { ... }, "timestamp": "...", "method": "POST", "path": "/classes" }
   ```
5. Errors handled by `ErrorInterceptor` + `HttpExceptionFilter`

## RPC status (see also `../.claude/rules/architecture.md`)

`gateway` reserves a `TUTOR_SERVICE` client (queue `tutor_queue`) and this repo's `main.ts`
starts an RMQ microservice listener on that same queue. Every owned feature has a
`{name}.rpc.controller.ts` with `@MessagePattern('<feature>.<methodName>')` handlers
(`@UseFilters(RpcExceptionFilter)`, from `@packages/filters`) delegating to the same
`*Service` class its HTTP controller uses — `class`, `curriculum`, `chapter`, `lesson`,
`tuition`, `schedule`, `session`, `exercise`, `attendance`, `dashboard`, `agents`, `report`.
`chat` is realtime (Socket.IO `chat.gateway.ts`) and intentionally has no RPC responder;
`src/features/user/*` is an internal read-only lookup against the shared `users` table (no
controller, no RPC — see its own doc comment) rather than an owned domain feature. Use the
`add-rpc-endpoint` skill (`../.claude/skills/`) on both repos when adding a new pattern.

## Environment Variables

| Variable                      | Description                    |
| ----------------------------- | ------------------------------- |
| `NODE_ENV`                    | Environment mode                |
| `PORT`                        | Server port (default `8888` — must be unique when running alongside the other 3 services) |
| `DATABASE_URL`                | Postgres connection URL         |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Must match `user`/`gateway`'s secrets |
| `JWT_ACCESS_EXPIRES_SECONDS` / `JWT_REFRESH_EXPIRES_SECONDS` | Token TTLs |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | Referenced but OAuth flows actually live in `gateway`/`user` — check before assuming this repo needs them configured |
| `RABBITMQ_URL`                | RabbitMQ connection URL (local `amqp://admin:admin@localhost:5672`; Railway: RabbitMQ service private URL) |
| `TUTOR_QUEUE`                 | RMQ listener queue name (default `tutor_queue`) |

No `REDIS_*`, `AWS_*`, `CLOUDINARY_*`, `MAIL_*`, or `RESEND_*` vars are read anywhere in `src/`
despite the matching packages being installed — don't add them to `.env` speculatively.

## Project Rules

@.claude/rules/nestjs-feature-pattern.md
@.claude/rules/database.md
@.claude/rules/conventions.md

## Automated Hooks

Configured in `.claude/settings.json` (scripts in `.claude/hooks/`):

- **PreToolUse (Write|Edit)** → `guard-paths.mjs` blocks edits to `.env*` and generated
  `drizzle/**` files.
- **PostToolUse (Write|Edit)** → `format-ts.mjs` runs prettier + eslint `--fix` on the
  touched `.ts/.js` file.
- **Stop** → `review-skills.mjs` runs after each task that changed `src/`, and asks Claude to
  review/update `.claude/rules/**`, `.claude/skills/**`, `.claude/agents/**`, and memory
  (`MEMORY.md` + memory files) so they stay in sync with new or changed patterns/facts.
