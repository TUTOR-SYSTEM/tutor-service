# Báo cáo bug: tutor-service (bugs và bảo mật)

Cập nhật: 2026-11-28. Trạng thái theo code hiện tại; jest 790/790 (53 suites), tsc sạch, eslint không lỗi (chạy lại trực tiếp).
Trạng thái: **Đã fix** = xong và có test; **Fix một phần** = còn việc; **Chưa xong** = chưa sửa; **Việc deploy** = cần làm khi triển khai.

| ID | Mức độ | Loại | Vấn đề | Trạng thái | Còn cần làm |
|---|---|---|---|---|---|
| TS-06 | Medium | Security | Lesson kèm `exerciseUrls` (R2 key) đọc được bởi mọi role | Đã xác nhận (theo thiết kế) | Sản phẩm xác nhận: học sinh/phụ huynh được xem `exerciseUrls` của lesson. Không đổi code. |
| TS-09 | Low | Bug | Hai đường gỡ học sinh không nhất quán; xoá `parentId` khi còn lớp khác | Đã fix | Chỉ còn một đường gỡ (`ClassRepository.removeStudent`, cả HTTP và RPC dùng chung). `parentId` giờ chỉ bị xoá khi học sinh không còn lớp nào (mọi gia sư). Xác nhận nghiệp vụ nếu muốn khác. |
| TS-23 | Low | Architecture | Ghi trực tiếp bảng `users` của service user | Đã fix (chờ deploy user-service) | Tutor không còn ghi `users`. Việc gán gia sư và gỡ phụ huynh gọi RPC `user.linkStudentsToTutor` và `user.releaseStudentParent` qua `UserLinkClient` (ký actor như gateway, `src/features/class/user-link.client.ts`), sau khi commit. user-service ghi link và lấy gia sư từ dòng lớp, không từ payload (`TutorLinkService` ở worktree `../user-tutor-link`, nhánh `feat/tutor-user-link`, chưa commit). Deploy: user-service trước, rồi tutor. Rủi ro: tutor giữ `RPC_ACTOR_SECRET` như gateway, nên tutor bị xâm phạm có thể giả ADMIN tới user-service; đề xuất secret riêng cho từng hop. Lỗi sau khi enrollment đã commit: retry thêm/gỡ là idempotent. |
| TS-01 | High | Security | RPC tin `userId`/`role` trong payload | Fix một phần | Đã có: seal HMAC và freshness (`rpc-identity.helper.ts`), validate Zod mọi payload RPC của class/curriculum/chapter/lesson/tuition/schedule/attendance; replay guard dùng bộ đếm `redis.incr` chung (third-service). ACL theo user RabbitMQ đã code trong cả bốn repo (`docker/rabbitmq/init-acl.mjs`, service `rabbitmq-acl` trong compose, mỗi service một user `gateway_svc`/`user_svc`/`tutor_svc`/`third_svc`). Đã kiểm trên broker tạm: 44 kiểm tra quyền, kiểm tra DLX/DLQ của third, và một vòng RPC đều đúng. Smoke run: tutor, user, gateway, third đều khởi động OK với ACL mới. Giới hạn: quyền publish chỉ áp lên `amq.default`, không áp được theo tên queue (RabbitMQ kiểm tra exchange, không phải routing key); muốn giới hạn đích thì cần exchange riêng cho từng service, là thay đổi lớn. Chưa làm: deploy lên broker đang chạy (cần tạo user, đổi `RABBITMQ_URL`, rồi recreate container); third chưa có `RABBITMQ_URL` trong compose, cấu hình ở `.env` local. |
| TS-26 | Info | Security | canAccessFile dùng substring `position()` | Fix một phần | Đã đối chiếu cột `theory_urls`/`exercise_urls`/`issue_urls`/`answer_key_urls` với `prisma/schema.prisma`. Còn chạy SQL trên Postgres thật (chưa chạy được ở đây). |
| TS-02 | High | Security | Gán `tutorId` tuỳ ý khi kết thúc buổi; bài tập ghi trước khi validate | Đã fix | Đổi tutorId khoá khi đã có bài nộp dùng `SESSION_TUTOR_LOCKED` (message riêng). Quyết định còn lại: `createSession`/`createSessions` có cần bắt buộc tutorId là gia sư của lớp không. |
| F-06 (cross-repo) | Medium | Security | Credential cứng trong compose và `.env.compose` được git theo dõi | Đã fix | Đã untrack `.env.compose` và `.env.compose.example`; compose bắt buộc biến môi trường cho Postgres và RabbitMQ (không còn fallback mật khẩu). Còn việc của bạn: xoay mật khẩu đã nằm trong git history. |
| TS-03 | Medium | Security | Mọi role ghi checklist dùng chung (`apiRoutes.*`); catalog lộ file/line | Đã fix | - |
| TS-04 | Medium | Security | `createClassConversation` không kiểm tra role/membership | Đã fix | Quyết định: ADMIN có được làm participant của class conversation không (hiện tạo được nhưng lấy lại bị 403). |
| TS-07 | Medium | Security/Cost | `ai.chat` không quota theo user, không timeout/budget, history Map không giới hạn | Đã fix | - |
| TS-08 | Medium | DoS | `courseProgress.sync` không giới hạn, nhiều query trong một transaction | Đã fix | - |
| TS-10 | Low | Bug | Kiểm tra chat TUTOR↔PARENT chỉ xét con đầu tiên | Đã fix | - |
| TS-11 | Low | Security | `message:read` không ràng buộc messageId với conversationId | Đã fix | - |
| TS-12 | Low | Bug | `createGroupConversation` không dedupe participantIds (409) | Đã fix | - |
| TS-13 | Low | Bug | `ai.history` với limit 0/undefined trả toàn bộ history | Đã fix | - |
| TS-14 | Low | Bug | Presence một socket/user; đóng một tab làm offline | Đã fix | - |
| TS-15 | Low | Security | Swagger luôn bật | Đã fix | Swagger bật khi không production hoặc `SWAGGER_ENABLED=true`. Helper `swagger.helper.ts` nằm ngoài phạm vi đã giao, cần xác nhận. |
| TS-16 | Low | Security | CORS ngoài production phản chiếu mọi origin kèm credentials | Đã fix | Production thiếu `CORS_ORIGINS` sẽ không khởi động. Cần đảm bảo biến này khi deploy. |
| TS-17 | Low | Security | Message lỗi thô (không phải Prisma) đến client | Đã fix | - |
| TS-18 | Low | Security (latent) | `getUserByField` trả cả password | Đã fix | - |
| TS-19 | Low | Security | Ghi cấu hình thanh toán không kiểm tra role | Đã fix | - |
| TS-20 | Low | Security | Học sinh gửi bài tới mọi TUTOR khi không có sessionId | Đã fix | - |
| TS-21 | Low | Security/DoS | Chat HTTP không validate; `limit`, `participantIds` không giới hạn | Đã fix | Quyết định ngưỡng: limit tối đa 100, participantIds tối đa 50. Route chat ở gateway chưa có trong `rmq.constants.ts`. |
| TS-22 | Low | DoS | `message:send` không giới hạn content, không rate limit | Đã fix | Quyết định ngưỡng: 4000 ký tự, 20 tin mỗi 10 giây theo socket. |
| TS-24 | Info | Security (latent) | `requestedRole` từ payload quyết định scope SQL | Đã fix | Dashboard thêm một query theo khoá chính mỗi lần gọi để lấy role từ DB. |
| TS-25 | Info | Security (latent) | `tuition.findById` bỏ qua scope khi thiếu userId | Đã fix | - |
| TS-05 | Medium | Security | Payment/PII của RPC vào `request_logs`, redaction thiếu | Đóng | Đã xoá logic log request (emitRequestLog, log-sink, log.create), không còn ghi payment/PII vào request_logs. |
