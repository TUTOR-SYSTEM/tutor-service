ALTER TABLE "exercises" ADD COLUMN IF NOT EXISTS "answer_key_urls" JSONB DEFAULT '[]'::jsonb;
