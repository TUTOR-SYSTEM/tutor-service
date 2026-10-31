# Rule: NestJS feature pattern

When adding or modifying a feature under `src/features/{name}/`, follow the established
layering — do not invent new shapes. Use `class` (`src/features/class/*`) as the canonical
reference. (The old `category`/`wallet`/`transaction` finance features have been removed —
this is now an education / tutoring domain.)

- **Layers**: `{name}.controller.ts` → `{name}.service.ts` → `{name}.repository.ts`, plus
  `{name}.module.ts`. Controllers hold no business logic (they only read `@CurrentUser()` and
  delegate); repositories hold all Prisma access (`PrismaService`). Every owned feature (all but `chat`, which
  is realtime via `chat.gateway.ts`) also has a `{name}.rpc.controller.ts` —
  `@UseFilters(RpcExceptionFilter)` (`@packages/filters`), one
  `@MessagePattern('<feature>.<methodName>')` per gateway call, delegating to the *same*
  `*Service` the HTTP controller uses. See `../../../.claude/rules/architecture.md` for the
  cross-repo RPC contract and the `add-rpc-endpoint` skill for adding a new pattern.
- **Entities live separately** under `src/packages/entities/{domain}/` as
  `{domain}.schema.ts` (Zod), `{domain}.dto.ts` (inferred types), and `index.ts` (barrel).
- **Service methods** are suffixed `...Service` (`createClassService`, `getClassesService`,
  `delClassService`) and take `{ userId, data | query | id }`; they validate the user and
  ownership before delegating to the repo.
- **Curriculum content ownership**: `curriculum` update/delete require `canActOnOwned` on
  `curriculum.userId` (ADMIN bypasses). `chapter` and `lesson` writes (create/update/delete) take a required `userId` in the
  service/RPC payload and authorize through the parent curriculum (`CurriculumRepository` is
  provided in both modules); misses are `404`. A lesson update strips `curriculumId` so a lesson
  can't be moved to another curriculum. Gateway sends `userId` on those six patterns. Reads stay
  open (shared library) — confirm with the PO before restricting.
- **Acting identity (CONTRACT C4)**: the gateway forwards `{ userId, role }` (from the verified JWT)
  in every RPC payload; HTTP controllers pass `user.id` / `user.role`. Services take an optional
  `role` and gate with `canActOnOwned({ userId, role }, ownerId)` from `@packages/helpers`, where
  `ADMIN` bypasses ownership and a missing role is non-admin (fail closed). Use it for every owner
  check instead of hand-written `tutorId === userId`.
- **Class creation**: only `TUTOR`/`ADMIN` may create a class; a tutor can only create for
  themselves (`tutorId === userId`), only `ADMIN` may assign another tutor, and the assignee must
  be a `TUTOR`/`ADMIN`.
- **Exercise create**: `studentId !== tutorId`, and when a `sessionId` is given the `tutorId` must be
  that session's class tutor (otherwise a student could name themselves tutor and self-grade).
- **Chat WebSocket**: `conversation:join` and `message:read` check `conversation_participants`;
  `typing:*` only works for sockets that already joined the room.
- **Validate optional cross-entity FKs in the service, not the DB.** Before an insert/update,
  check that any optional foreign-key value (e.g. `lessonId`, `tutorId`) actually references an
  existing row — inject the owning service (`LessonService.getLessonByIdService`,
  `UserService.getUserByField`) and throw `NotFoundException` on a miss. Never let a bad FK fall
  through to Postgres (a raw `23503` surfaces as an ugly 500). Owner-type FKs (`tutorId`) default
  to the acting `userId` when omitted; only validate them when a different value is passed. See
  `SessionService.resolveSessionRefs` as the reference.
- **Repository list methods** return `{ <resource>, pagination: { total, page, limit,
  totalPages } }` — the list key is named after the resource (e.g. `classes`), not `data`.
- **Child resources** (owned via a parent `class`, e.g. `schedule`/`session`) authorize
  *through the parent*: inject the parent service, check `parent.tutorId === userId`, and throw
  `NotFoundException` (not `Forbidden`) on a miss. The primary listing is by parent
  (`GET /schedules/class/:classId`). Bulk create takes `{ parentId, items: [...] }` and does one
  multi-row insert (`repo.createMany`). See `src/features/schedule/*` as the reference.
- **User-scoped "my" list** (optional): a child resource may *also* expose a global paginated
  list scoped to every parent the acting user can reach — classes they own (`classes.tutorId =
  userId`) **or** are enrolled in (`class_students.studentId = userId`) — so one route serves both
  tutor and student. Build the two id sets with subqueries and `or(inArray(...), inArray(...))`,
  `leftJoin` the parent to nest its summary (`class { id, name, code, subject }`) on each row, and
  still return `{ <resource>, pagination }`. See `SessionRepository.getAll` (`GET /sessions`).
- **Admin endpoints**: use `@Roles('ADMIN')` decorator (from `@packages/decorators`) +
  `RolesGuard` (from `@packages/guards`) — not a non-existent `@Admin()` decorator.
- **Error messages**: use `ERROR_MESSAGES` constants from `src/data/constants/error.constant.ts`.
  Never hardcode strings in `BadRequestException` / `ConflictException` / etc. For messages with
  dynamic values, compose via template literal: `` `${ERROR_MESSAGES.EMAIL_EXISTS}: ${email}` ``.
- **Success responses**: use `ApiResponse` decorator from `@packages/decorators` for swagger
  metadata. Response body `message` can come from `SUCCESS_MESSAGES` or be inline depending on
  context.
- **List query conditions**: `buildListWhereClause({ search, searchFields, filters })` from
  `@packages/helpers` is the standard helper for search+filter list endpoints — it returns a Prisma
  `where` object (`OR` of case-insensitive `contains` over `searchFields`, `AND` exact-match
  `filters`) or `undefined`. For simple queries (≤2 filters), a hand-written `where` in the
  repository is acceptable. `searchFields` is declared *inside the repository* — the
  service/controller only pass through `page`/`limit`/`search`/raw filter values from the query
  DTO, never an empty `{}` placeholder. See `ClassRepository.getClasses` or
  `CurriculumRepository.findAll` (search matches `subject` + `code`) as the reference. Also:
  double-check a `GET .../` controller imports its *own* domain's `get{Name}sQuerySchema` /
  `Get{Name}sQueryDto` — copy-pasting from another feature (e.g. a leftover wallet/category/
  transaction import) silently drops fields like `search` from validation.
- **Nesting a parent's children into a paginated list row** (e.g. each class row in
  `GET /classes` carries its `students` and `schedules`): after fetching the page of parent
  rows, collect their ids, then fetch all children for that whole id set in one query per child
  type via `inArray(child.parentId, parentIds)` (run the child queries together with
  `Promise.all`), group each result into a `Map<parentId, child[]>`, and attach
  `map.get(parent.id) ?? []` when mapping the final response. Never loop the parent rows and
  query per-row (N+1). Skip the child queries entirely when the id list is empty. See
  `ClassRepository.getClasses` (students + schedules) as the reference; the single-row
  equivalent (`ClassRepository.getClass`) just does one join since there's only one parent id.
- **M:N enrollment / linking** (e.g. add students to a class via `class_students`): expose a
  `POST /classes/:id/students` taking `{ studentIds: [...] }` (one route serves both single and
  bulk — a single is just a length-1 array). The service checks parent ownership
  (`class.tutorId === userId` → `NotFound`), dedupes the ids, and validates each references an
  existing user of the right role. The repo does one multi-row insert into the join table with
  `.onConflictDoNothing().returning()` (relies on the `(class_id, student_id)` unique index), so
  re-adding is a safe no-op. Return `{ <parentId>, added, skipped, <ids> }`. See
  `ClassService.addStudentsService` / `ClassRepository.addStudents`.
- **Swagger content** lives in `src/data/swaggers/data/{name}.swagger.ts` and
  `src/data/swaggers/messages/{name}.msg.ts`, not inline strings.
- **Register** every new module in `src/app.module.ts` `imports: [...]`, and import the
  modules of any sibling services it injects.
- **Route names are plural** (`@Controller('classes')`); class/file names are singular.
- Reuse existing helpers — `buildListWhereClause`, `checkUuidValid`, `generateCode`
  (`@packages/helpers`), `ZodValidationPipe` (`@packages/pipes`), `@CurrentUser`/`@Public`/
  `@Admin` (`@packages/decorators`). Never re-implement pagination, validation, or UUID checks,
  and do not use the old `@User` decorator.
- **Infra modules**: none live here any more (`redis`/`email`/`uploads` moved to
  `third-service`; the old `rabbitmq` pub/sub module was removed). If one is added, it's a
  deliberate exception to the layering above: `@Global()` module, one `Service` owning the
  connection lifecycle (`OnModuleInit`/`OnModuleDestroy`, config via `ConfigService`, `Logger`
  not `console.log`), exported so any feature can inject it directly. Inbound RPC is the RMQ
  microservice `main.ts` opens on `tutor_queue`; if this service ever needs to *call* another
  one, copy gateway's `src/features/rabbitmq/` (`RmqModule`/`RmqProducer`) as `user` did.
- **`src/features/user/*`** is a deliberate exception too — a read-only lookup (`getUserByField`)
  against the shared `users` table (this DB and `user`'s DB are the same Postgres instance).
  No controller, no `.rpc.controller.ts`, not a domain feature — don't add write methods or a
  controller to it; the `user` service owns that data.
