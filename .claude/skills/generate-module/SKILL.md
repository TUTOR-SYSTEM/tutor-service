---
name: generate-module
description: Scaffold the NestJS module (src/features/{name}/{name}.module.ts) and wire it into src/app.module.ts imports. Use when asked to create/add a module or register a feature in this NestJS tutoring backend.
---

# Generate Module + Wire

Create `src/features/foo/foo.module.ts` and register it in `app.module.ts`.

## Prerequisites
Controller, service, and (optionally) repository exist for the feature.

## `foo.module.ts` (mirror class.module.ts)
```ts
import { Module } from '@nestjs/common';
import { FooController } from './foo.controller';
import { FooRepository } from './foo.repository';
import { FooService } from './foo.service';
import { UserModule } from '../user/user.module';

@Module({
  imports: [UserModule], // + any sibling feature module whose service Foo injects (e.g. LessonModule)
  controllers: [FooController],
  providers: [FooService, FooRepository],
  exports: [FooService], // export if another feature will inject FooService
})
export class FooModule {}
```
Drop `FooRepository` from providers if the feature has no repository. Every service injected
by `FooService` (see `generate-service`) must have its module listed in `imports` and be
`exports`-ed by that module.

## Wiring `src/app.module.ts` (required)
1. Add `import { FooModule } from './features/foo/foo.module';` with the other feature imports.
2. Add `FooModule` into the `imports: [...]` array, grouped near related feature modules.

## After
Run `bun run build` (or `bunx tsc --noEmit`) to confirm the module resolves and DI compiles.

## Not for infra modules
This scaffold is for domain feature modules. A module wrapping an external connection
(none owned here today; `redis`/`email`/`uploads` live in `third-service`) is
`@Global()`, has no repository/controller, and exports its service(s) directly — see the
"Infra modules" note in `.claude/rules/nestjs-feature-pattern.md`. Also not for the RPC layer:
`{name}.rpc.controller.ts` is added by the `add-rpc-endpoint` skill, not this one.
