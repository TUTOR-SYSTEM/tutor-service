-- Một dòng bài tập cho mỗi (buổi, học sinh): chặn trùng khi "kết thúc buổi" chạy song song.
-- Trước khi áp dụng, kiểm tra không có dữ liệu trùng (nếu có, migration sẽ lỗi 23505):
--   SELECT session_id, student_id, count(*) FROM exercises
--   WHERE session_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;

-- CreateIndex
CREATE UNIQUE INDEX "exercises_session_id_student_id_key" ON "exercises"("session_id", "student_id");
