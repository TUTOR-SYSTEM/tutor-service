-- CreateTable
CREATE TABLE "tutor_settings" (
    "tutor_id" UUID NOT NULL,
    "session_duration_minutes" INTEGER NOT NULL DEFAULT 90,
    "default_fee" DECIMAL(14,2) NOT NULL DEFAULT 250000,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'hanoi',
    "work_hours_start" VARCHAR(5) NOT NULL DEFAULT '08:00',
    "work_hours_end" VARCHAR(5) NOT NULL DEFAULT '21:00',
    "remind_students" BOOLEAN NOT NULL DEFAULT true,
    "allow_online_booking" BOOLEAN NOT NULL DEFAULT true,
    "auto_invoice_monthly" BOOLEAN NOT NULL DEFAULT false,
    "break_between_sessions" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tutor_settings_pkey" PRIMARY KEY ("tutor_id")
);

-- AddForeignKey
ALTER TABLE "tutor_settings" ADD CONSTRAINT "tutor_settings_tutor_id_fkey" FOREIGN KEY ("tutor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
