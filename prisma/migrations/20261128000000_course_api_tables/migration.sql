-- Tables and enum for the course-progress and api-routes features, which exist in prisma/schema.prisma
-- but were not created by any earlier migration. Generated from the schema and filtered: DROP statements
-- for the removed test-scenario tables and the users.must_change_password column are NOT included.
-- The test-scenario tables are still in the DB built by 0_init/0_tutor_schema; drop them in a separate,
-- reviewed migration when the cleanup is confirmed.

-- CreateEnum
CREATE TYPE "course_item_kind" AS ENUM ('LAB', 'DEBUG');

-- CreateTable
CREATE TABLE "course_quiz_answers" (
    "user_id" UUID NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "question_index" INTEGER NOT NULL,
    "option_index" INTEGER,
    "wrong_count" INTEGER NOT NULL DEFAULT 0,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "answered_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_quiz_answers_pkey" PRIMARY KEY ("user_id","lesson_id","question_index")
);

-- CreateTable
CREATE TABLE "course_quiz_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "completed_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "course_quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_item_results" (
    "user_id" UUID NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "kind" "course_item_kind" NOT NULL,
    "item_key" TEXT NOT NULL,
    "passed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_item_results_pkey" PRIMARY KEY ("user_id","lesson_id","kind","item_key")
);

-- CreateTable
CREATE TABLE "course_learning_results" (
    "user_id" UUID NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "quiz_attempts" INTEGER NOT NULL DEFAULT 0,
    "quiz_best" INTEGER,
    "quiz_total" INTEGER,
    "quiz_last_at" TIMESTAMP(6),
    "labs_passed" INTEGER NOT NULL DEFAULT 0,
    "labs_total" INTEGER NOT NULL DEFAULT 0,
    "debugs_solved" INTEGER NOT NULL DEFAULT 0,
    "wrong_total" INTEGER NOT NULL DEFAULT 0,
    "flagged" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_learning_results_pkey" PRIMARY KEY ("user_id","lesson_id")
);

-- CreateTable
CREATE TABLE "api_route_results" (
    "route_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "doc" JSONB NOT NULL DEFAULT '{}',
    "updated_by" UUID,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_route_results_pkey" PRIMARY KEY ("route_id")
);

-- CreateTable
CREATE TABLE "api_routes" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "svc" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "handler" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "line" INTEGER,
    "auth" TEXT NOT NULL,
    "dto" TEXT NOT NULL,
    "dev" BOOLEAN NOT NULL DEFAULT false,
    "flags" JSONB NOT NULL DEFAULT '[]',
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_catalog" (
    "scan_id" TEXT NOT NULL,
    "scanned_at" TEXT NOT NULL,
    "commits" JSONB NOT NULL DEFAULT '{}',
    "branches" JSONB NOT NULL DEFAULT '{}',
    "services" JSONB NOT NULL DEFAULT '{}',
    "sends" JSONB NOT NULL DEFAULT '[]',
    "order" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_catalog_pkey" PRIMARY KEY ("scan_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_quiz_attempts_unique" ON "course_quiz_attempts"("user_id", "lesson_id", "completed_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_routes_key_key" ON "api_routes"("key");
