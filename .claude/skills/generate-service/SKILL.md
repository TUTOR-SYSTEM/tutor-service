---
name: generate-service
description: Scaffold the service layer (src/features/{name}/{name}.service.ts) — business logic with Logger, UUID validation, owner/existence checks, NotFound/BadRequest/Conflict handling, delegating to the repository. Use when asked to create/add a service or business-logic layer for a feature in this NestJS tutoring backend.
---

# Generate Service

Create `src/features/foo/foo.service.ts`, mirroring `class.service.ts`.

## Prerequisites
- `FooRepository` exists (see `generate-repository`).
- DTOs exist under `@packages/entities/foo`.

## Shape
```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateFooDto, GetFoosQueryDto } from '@packages/entities/foo';
import { checkUuidValid, generateCode } from '@packages/helpers';
import { FooRepository } from './foo.repository';
import { UserService } from '../user/user.service';

@Injectable()
export class FooService {
  private readonly logger = new Logger(FooService.name);
  constructor(
    private readonly repo: FooRepository,
    private readonly prisma: PrismaService,
    private readonly user: UserService, // + other feature services it depends on
  ) {}
  // createFooService, getFoosService, getFooService, delFooService
}
```

## Methods (mirror class.service.ts — note the `...Service` suffix)
- `createFooService({ userId, data })` — validate `userId` is a UUID (`checkUuidValid`),
  confirm the user exists via `this.user.getUserByField({ field: 'id', value: userId })`,
  duplicate-check unique fields via `this.repo.getFooByField({ field, value })`, validate any
  FK ids (e.g. `tutorId`) the same way, then `this.repo.create({ data })`.
- `getFoosService({ userId, query })` — validate `userId`, confirm user exists, then
  `this.repo.getFoos({ userId, query })`.
- `getFooService({ userId, id })` — validate `userId`, confirm user exists, then
  `this.repo.getFoo({ id })`.
- `delFooService({ userId, id })` — validate both UUIDs, confirm user + row exist, enforce
  ownership (`row.tutorId !== userId` → `NotFoundException`), then `this.repo.delFoo({ id })`.
- If the domain needs a unique human code, add `generateNewCodeService()` — loop
  `generateCode()` (from `@packages/helpers`) with a MAX_RETRIES cap, `ConflictException` on
  exhaustion (see `class.service.ts`).

## Child resources owned through a parent (see `schedule.service.ts`)
When the feature is a child of `class` (e.g. `schedule`, `session`) and has no `tutorId` of its
own, authorize **through the parent class** instead of re-checking the user table:
- Inject the parent's service (`private readonly classService: ClassService`) and import
  `ClassModule` in the feature module.
- Add a private guard that loads the parent and enforces ownership, reused by every method:
  ```ts
  private async assertClassOwner({ userId, classId }: { userId: string; classId: string }) {
    if (!classId || !checkUuidValid({ data: classId }))
      throw new BadRequestException('Class Id must be uuid ...');
    const classData = await this.classService.getClassService({ userId, id: classId });
    if (!classData || (Array.isArray(classData) && classData.length === 0))
      throw new NotFoundException('Class not found ...');
    if (classData.tutorId !== userId) throw new NotFoundException('Class not found ...');
    return classData;
  }
  ```
- For get/update/delete by the child's own id, first load the child row, then call
  `assertClassOwner({ userId, classId: row.classId })` (see `loadOwnedSchedule`). Return
  `NotFoundException` (not `Forbidden`) on an ownership miss so records aren't enumerable.
- List by parent instead of a global paginated list: `get{Children}ByParentService({ userId,
  parentId })` → guard, then `repo.getByParent({ parentId })`.

## Bulk create (see `createSchedulesService`)
For a `{ parentId, items: [...] }` bulk schema, add `create{Children}Service({ userId, data })`
that runs the parent-owner guard once, then delegates to a single `repo.createMany({ parentId,
items })` (one multi-row insert — do NOT loop single inserts).

## Rules
- Validate every UUID param with `checkUuidValid({ data: id })` before hitting the DB.
- `BadRequestException` for bad input, `NotFoundException` when a row is missing / not owned,
  `ConflictException` for unresolvable uniqueness collisions.
- Inject sibling feature services (`UserService`, `NotificationService`, …) rather than
  re-querying their tables directly; import their modules in `foo.module.ts`.
- Keep Prisma model access in the repository; the injected `prisma` is only for cross-table
  transactions when needed.
