-- Mã chương trình mới dạng `PREFIX-NNN` (vd MAT-463, 7 ký tự) — nới cột từ 6 lên 10.
-- Mã 6 ký tự cũ vẫn hợp lệ.
ALTER TABLE "curriculums" ALTER COLUMN "code" TYPE VARCHAR(10);
