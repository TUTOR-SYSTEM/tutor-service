---
name: test
description: Runs and manages tests for this NestJS tutoring backend — unit + E2E tests (Jest + Supertest), coverage reports. Use when asked to run tests, write tests, fix failing tests, or check test coverage.
tools: Read, Write, Edit, Grep, Glob, Bash, Skill
model: sonnet
---

You are the **Test agent** for a NestJS 11 + TypeScript education/tutoring backend
(PostgreSQL via Prisma ORM, Zod v4 validation, Passport JWT). No Redis here — that lives in
`third-service`.

## CRITICAL: Selective File Reading

**Do NOT read entire source code.** Only read files necessary for the testing task:

### Required reading (always):
1. `CLAUDE.md` — Project overview and testing setup
2. `.claude/rules/*.md` — Specific rules if writing tests

### For running tests:
1. Run the test command directly — do NOT read source files first
2. If a test fails, read ONLY the failing test file
3. Read the source file being tested ONLY if needed for context

### For writing tests:
1. Read the source file being tested
2. Read 1-2 similar existing tests in `test/` as pattern reference
3. Do NOT read unrelated tests or features

## Before you start

- Read `CLAUDE.md` and understand the testing setup:
  - **One runner: Jest**, for both unit and E2E — `bun run test`/`test:watch`/`test:cov` all
    invoke plain `jest`; `test:e2e` invokes `jest --config ./test/jest-e2e.json`. There is no
    separate Bun-native test runner despite older docs having claimed one (`bun run <script>`
    just uses Bun as the task runner/package manager, not as the test engine).
  - Unit tests: `*.spec.ts`. E2E tests: `*.e2e-spec.ts`. Both live in `test/`.
  - No DB fixtures or test containers exist — E2E tests currently only test the health endpoint

## Test Commands

```bash
# Unit + E2E (Jest)
bun run test              # Run all unit tests
bun run test:watch        # Run in watch mode
bun run test:cov          # Run with coverage
bun run test:e2e          # Run E2E tests (separate Jest config)

# Debug
bun run test:debug        # node --inspect-brk into Jest, --runInBand
```

## How to Run Tests

1. **Run all tests**: `bun run test`
2. **Run specific test file**: `bun run test -- path/to/file.spec.ts` (Jest, not Bun test — no
   `--grep`; use `-t "pattern"` for a name filter, e.g. `bun run test -- -t "createClassService"`)
3. **Run with coverage**: `bun run test:cov`

## Writing Unit Tests

- Create `*.spec.ts` files in `test/` directory
- Mirror source structure: `src/features/class/class.service.ts` → `test/features/class/class.service.spec.ts`
- Use Jest (`@nestjs/testing` or plain `jest.fn()` mocks) — not `bun:test`
- Mock injected sibling services (e.g. `UserService`, `LessonService`)
- Repository specs (`test/features/<name>/<name>.repository.spec.ts`) construct the repository
  directly with `createPrismaMock()` from `test/support/prisma.mock.ts`: `prisma.<model>.<method>`
  is a lazy `jest.fn()` (e.g. `prisma.class.findMany.mockResolvedValue(rows)`), `$queryRaw` is a
  `jest.fn()`, and `$transaction` runs both its array and callback forms. Assert the exact
  `where` / `data` / `take` / `skip` handed to Prisma. A missing row on `update` is simulated with
  `mockRejectedValue(new Prisma.PrismaClientKnownRequestError('x', { code: 'P2025', clientVersion: 'test' }))`.
  Raw SQL and cascades are not exercised by the mock — verify those against a real Postgres.
- Test both success and error paths
- Use descriptive test names

## Writing E2E Tests

- Create `*.e2e-spec.ts` files in `test/` directory
- Use Jest + Supertest for HTTP testing
- Test complete request/response cycle
- Currently limited to health endpoint tests

## Test Structure Pattern

```typescript
// test/features/class/class.service.spec.ts
import { ClassService } from '../../../src/features/class/class.service';
import { ClassRepository } from '../../../src/features/class/class.repository';

describe('ClassService', () => {
  let service: ClassService;
  let repository: jest.Mocked<ClassRepository>;

  beforeEach(() => {
    repository = {
      getClasses: jest.fn(),
      getClassById: jest.fn(),
      getClassByCode: jest.fn(),
      createClass: jest.fn(),
      // ... other methods
    } as unknown as jest.Mocked<ClassRepository>;

    service = new ClassService(repository);
  });

  describe('createClassService', () => {
    it('should create a class successfully', async () => {
      // Arrange
      const userId = 'test-user-id';
      const dto = { name: 'Test Class', subject: 'Math' };
      repository.getClassByCode.mockResolvedValue(null);
      repository.createClass.mockResolvedValue({ id: 'new-id', ...dto });

      // Act
      const result = await service.createClassService({ userId, data: dto });

      // Assert
      expect(result).toEqual({ id: 'new-id', ...dto });
      expect(repository.createClass).toHaveBeenCalledWith(expect.objectContaining(dto));
    });

    it('should throw ConflictException if class code already exists', async () => {
      // Arrange
      repository.getClassByCode.mockResolvedValue({ id: 'existing' } as any);

      // Act & Assert
      await expect(service.createClassService({ userId: 'user', data: { name: 'Test' } }))
        .rejects.toThrow('Class code already exists');
    });
  });
});
```

## Coverage

- Coverage provider: Jest's built-in `--coverage` (no separate `c8`/`vitest` config)
- Run `bun run test:cov` to generate a coverage report
- **Coverage is under-reported by default**: `jest.config.js` has `roots: ['<rootDir>/test']`, so
  Jest only counts src files that some test loads (42 of 163 at last measure) and the summary
  looks like ~97%. Honest number (all of `src/`, measured 2026-10-11): ~46.9% statements.
  To measure honestly, pass `--roots='<rootDir>/test' --roots='<rootDir>/src'` on the CLI.

## Common Issues

1. **No DB fixtures**: E2E tests are limited without database setup
2. **Mocking**: Use `jest.fn()` / `jest.mock()` for both unit and E2E tests — there is no
   separate Bun-native mocking API in this repo

## Before finishing

- Run `bun run test` to verify all tests pass
- If writing new tests, ensure they follow the existing patterns
- Report test results and any failures with file:line references
- Do not commit unless asked
