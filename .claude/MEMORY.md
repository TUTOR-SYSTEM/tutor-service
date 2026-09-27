# Backend Memory — tutor-service (education domain)

## Project Structure

```
tutor-service/
├── src/
│   ├── main.ts                    # Bootstrap: CORS, interceptors, filters, RMQ listener (tutor_queue), listen (port 8888)
│   ├── app.module.ts              # Root module (imports all feature modules)
│   ├── app.controller.ts          # Health-check controller
│   ├── app.service.ts             # Health-check service
│   ├── database/
│   │   ├── database.module.ts     # Global Drizzle ORM provider (postgres.js)
│   │   └── schema.ts              # Real tables: users, grades, classes, class_students, schedules,
│   │                               # class_sessions, curriculums, chapters, lessons, tuitions,
│   │                               # notifications, student_scores, ai_messages, attendances,
│   │                               # exercises, conversations, conversation_participants, messages
│   │                               # (categories/wallets/transactions are commented-out dead code)
│   ├── features/                  # class, schedule, session, curriculum, chapter, lesson, tuition,
│   │                               # exercise, attendance, chat, report, dashboard, agents, user
│   │                               # (no email/redis/uploads features here — those live in
│   │                               # `third-service`; no message-queue module — responder only)
│   └── packages/                  # Shared utilities
│       ├── configs/               # JWT sign config
│       ├── decorators/            # @ApiResponse, @Public, @Roles, @CurrentUser decorators
│       ├── entities/              # DTOs + Zod schemas per domain (class, schedule, session, ...)
│       ├── filters/               # HttpExceptionFilter (global)
│       ├── guards/                # JwtAuthGuard (global), RolesGuard
│       ├── helpers/                # hashing, JWT, buildListWhereClause, generateCode
│       ├── interceptor/           # ResponseInterceptor, ErrorInterceptor, LoggerInterceptor
│       ├── interfaces/            # ApiResponseInterface, UserInterface
│       ├── pipes/                 # ZodValidationPipe
│       └── strategy/              # Google/Facebook Passport strategies
├── drizzle/                       # Auto-generated SQL migrations
├── scripts/                       # Seed scripts (Bun runtime) — some (seed-categories/seed-wallet)
│                                   # target dropped tables, don't run them
└── test/                          # Jest + Supertest tests
```

## Feature Module Pattern

```
features/{name}/
├── {name}.module.ts     # Module definition
├── {name}.controller.ts # Route handlers (@Body with ZodValidationPipe)
├── {name}.service.ts    # Business logic
└── {name}.repository.ts # Drizzle DB access
```

`class` is the canonical reference feature — see `.claude/rules/nestjs-feature-pattern.md` for
the full layering and child-resource authorization rules. Every owned feature except `chat`
also has a `{name}.rpc.controller.ts` (see RPC status below).

## RPC status

`gateway` reserves a `TUTOR_SERVICE` client (`tutor_queue`) and this repo's `main.ts` starts an
RMQ listener on that queue. **All 12 owned features have `@MessagePattern` responders**
(`class`, `curriculum`, `chapter`, `lesson`, `tuition`, `schedule`, `session`, `exercise`,
`attendance`, `dashboard`, `agents`, `report`) — this service is reachable from `gateway`.
`chat` stays realtime-only (`chat.gateway.ts`, Socket.IO), no RPC responder. See
`../.claude/rules/architecture.md` and the `add-rpc-endpoint` skill for adding a new pattern.

## Environment Variables

| Variable                      | Description                    |
| ----------------------------- | ------------------------------- |
| `NODE_ENV`                    | Environment mode                |
| `PORT`                        | Server port (default `8888`)    |
| `DATABASE_URL`                | Postgres connection URL         |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Must match `gateway`/`user` |
| `JWT_ACCESS_EXPIRES_SECONDS` / `JWT_REFRESH_EXPIRES_SECONDS` | Token TTLs |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | Referenced in code but OAuth actually happens in `gateway`/`user` |
| `RABBITMQ_URL`                | RabbitMQ connection (local `amqp://admin:admin@localhost:5672`; Railway: RabbitMQ service private URL) |
| `TUTOR_QUEUE`                 | RMQ listener queue (default `tutor_queue`) |

No `REDIS_*`/`MAIL_*`/`AWS_*`/`CLOUDINARY_*`/`RESEND_*` vars are read anywhere in `src/` —
those packages are installed but unused leftovers from the shared template. Don't configure them.

## Docker Services

`docker-compose.yml` provides Postgres (`POSTGRES_PORT`, default `5432`) and Redis
(`REDIS_PORT`, default `6380`→`6379`) containers — Redis runs but nothing in this repo connects
to it currently.

## Testing

- **One runner: Jest** (+ Supertest for e2e). `bun run test`/`test:e2e` both invoke Jest —
  there is no separate Bun-native test runner despite older docs having claimed one.
- Unit tests `*.spec.ts`, e2e `*.e2e-spec.ts`, both in `test/`.

## Available Skills

`generate-controller`, `generate-db-table`, `generate-entity`, `generate-feature`,
`generate-module`, `generate-repository`, `generate-service` — all scoped to this repo's own
`class`-style layering.

## Available Agents

`dev.md`, `review.md`, `security.md`, `test.md` — see `.claude/agents/`.

## Rules

`conventions.md`, `database.md`, `nestjs-feature-pattern.md` (this repo) plus
`../.claude/rules/architecture.md` and `shared-conventions.md` (cross-service).

## Selective File Reading Guideline (IMPORTANT)

**Do NOT read entire source code.** Only read files necessary for the task — see
`CLAUDE.md`'s "IMPORTANT: Selective File Reading" section for the full breakdown.
