-- CreateTable
CREATE TABLE "tutor_payment_settings" (
    "tutor_id" UUID NOT NULL,
    "bank_name" VARCHAR(100) NOT NULL DEFAULT '',
    "account_holder" VARCHAR(255) NOT NULL DEFAULT '',
    "account_number" VARCHAR(30) NOT NULL DEFAULT '',
    "branch" VARCHAR(255) NOT NULL DEFAULT '',
    "auto_payment_reminder" BOOLEAN NOT NULL DEFAULT true,
    "electronic_receipt" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tutor_payment_settings_pkey" PRIMARY KEY ("tutor_id")
);

-- AddForeignKey
ALTER TABLE "tutor_payment_settings" ADD CONSTRAINT "tutor_payment_settings_tutor_id_fkey" FOREIGN KEY ("tutor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
