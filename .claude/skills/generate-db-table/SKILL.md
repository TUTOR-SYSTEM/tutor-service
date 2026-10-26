---
name: generate-db-table
description: Add a Prisma model (and any enum) to prisma/schema.prisma for a new domain, then generate the migration. Use when asked to create/add a database table, schema, column, or enum in this NestJS tutoring backend.
---

# Generate Prisma Model

Add a `model` (and needed `enum`s) to `prisma/schema.prisma`, following the style of the
existing `Class` / `Tuition` models.

## Inputs
- Table name (plural, snake_case), e.g. `invoices` → model `Invoice`.
- Columns with types, nullability, defaults, foreign keys, and any enum values.

## Conventions
- Model is PascalCase singular, mapped to the plural snake_case table: `@@map("invoices")`.
- UUID primary key: `id String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid`.
- Enums are declared with `@@map` to keep the Postgres type name:
  ```prisma
  enum FooStatus {
    A
    B

    @@map("foo_status")
  }
  ```
- Columns: camelCase field, snake_case column via `@map("user_id")`; add `@db.Uuid`,
  `@db.VarChar(255)`, `@db.Decimal(14, 2)`, `@db.Timestamp(6)` to match the width/type.
- Foreign keys declare both the scalar and the relation, and need a back-relation on the other model:
  ```prisma
  userId String @map("user_id") @db.Uuid
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  ```
- Timestamps:
  ```prisma
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamp(6)
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamp(6)
  ```
- Unique / index names are explicit: `@@unique([classId, studentId], map: "class_students_unique")`.

## After editing schema.prisma
1. `bunx prisma format` then `bun run db:migrate:dev -- --name <change>` to create + apply the
   migration under `prisma/migrations/` (needs a dev DB; use `bun run db:generate` to just refresh
   the client).
2. Commit the new migration folder. Other environments run `bun run db:migrate`.
3. Do NOT hand-edit files in `prisma/migrations/` — they are generated (a hook blocks it).
4. The DB is shared with `gateway`/`user`/`third-service`, which still use Drizzle: mirror the change in
   `gateway/src/database/schema.ts` until they migrate too (see `.claude/rules/database.md`).
