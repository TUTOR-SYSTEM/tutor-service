-- Sĩ số tối đa của lớp (1 = 1 kèm 1, 10 = lớp nhóm). Lớp cũ mặc định 10.
ALTER TABLE "classes" ADD COLUMN IF NOT EXISTS "max_students" INTEGER NOT NULL DEFAULT 10;
