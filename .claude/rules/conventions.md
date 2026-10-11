# Rule: Code conventions

- **Imports**: use the `@packages/*` alias for anything under `src/packages/`
  (e.g. `import { Public } from '@packages/decorators'`) — never long relative `../../..` paths.
- **Validation**: every request body/query is validated with a **Zod v4** schema via
  `new ZodValidationPipe<Dto>(schema)`. DTOs are `z.infer<>` types, never hand-written interfaces.
  Pagination query schemas use plain `z.coerce.number()` fields (`page`/`limit`), not `z.preprocess`.
- **Secrets**: never read, print, or edit `.env*` files (a PreToolUse hook blocks edits).
  Reference config via `process.env` / `ConfigModule`.
- **Style**: single quotes, trailing commas, 100-char width, semicolons. Formatting/lint is
  auto-applied by a PostToolUse hook, so match surrounding code and let the hook normalize it.
- **Auth**: routes are guarded globally by `JwtAuthGuard`; add `@Public()` only for
  intentionally open endpoints, and `@Roles('ADMIN')` (from `@packages/decorators`, paired with
  `RolesGuard` from `@packages/guards`) for admin-only ones. `AdminRoleGuard` is also available
  in `@packages/guards`. Read the acting user with `@CurrentUser()` from `@packages/decorators`
  (returns the JWT payload; use `user.id`). **No fallback JWT secret**: read it only through
  `resolveJwtAccessSecret(configService)` (`@packages/configs/jwt-sign.config`), which throws when
  `JWT_ACCESS_SECRET`/`JWT_SECRET` is unset. Nothing is `@Public()` except health — the demo
  `POST /run` (agents) now needs a JWT because every call starts a paid Claude session.
- **Zod `update` schemas**: Zod 4's `.partial()` KEEPS the `.default(...)` of wrapped fields, so
  `createX.partial()` makes an update that omits a field overwrite it with the default (tuition
  `status`→UNPAID, class `tuition/status/format`→0/OPEN/OFFLINE, schedule `format`, chapter/lesson
  `order`→0). Redeclare every defaulted field with `.extend({ field: <type>.optional() })` in the
  update schema — and do the same in gateway's copy of the schema, since gateway validates first
  and forwards the already-defaulted DTO. Date fields that can be cleared use
  `z.coerce.date().nullable().optional()` (`z.coerce.date()` alone turns `null` into 1970-01-01).
  `test/packages/entities/update-schemas.spec.ts` guards this.
- **Date helper** (`@packages/helpers/date.helper`): `toDate(value)` turns an ISO string into a
  `Date` (passes `Date`/`null`/`undefined` through). Use it on every date field of an insert/update
  that comes from an RPC payload — see `database.md`.
- **Helpers** (`@packages/helpers`): `checkUuidValid` / `generateCode` (from `generate.helper`),
  `hashData` / `compareData` (bcrypt from `hashingData.helper`), `buildListWhereClause` (for
  paginated list queries), `signAccessToken` / `signRefreshToken` (from `jwt.helper`).
- **Messages**: error strings in `ERROR_MESSAGES` (`src/data/constants`); success strings in
  `SUCCESS_MESSAGES` (same barrel). Never hardcode message text in services.
- **Swagger**: body/query schemas in `src/data/swaggers/data/{name}.swagger.ts`, response
  messages in `src/data/swaggers/messages/{name}.msg.ts`. Use `@ApiResponse()` decorator from
  `@packages/decorators` for success messages.
