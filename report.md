# Báo cáo review tĩnh: tutor-service (bugs & bảo mật)

- **Ngày:** 2026-11-27
- **Phạm vi:** `/home/user/tutor-service` (NestJS 11 + Prisma; class, schedule, session, curriculum, lesson, chapter, exercise, attendance, tuition, chat HTTP + Socket.IO, report, dashboard, course-progress, api-routes, tutor-settings, agents; RPC qua RabbitMQ `tutor_queue`)
- **Commit / branch:** `2ef149b` / `ccr-6e14d698-ruxjzr` (working tree sạch)
- **Cách làm:** review tĩnh (đọc code + grep). Không chạy service/test, không sửa source. Đối chiếu chỉ đọc với `/home/user/gateway` (route guard, ký RPC).

## 1. Tóm tắt

Tổng **26 finding**: Critical 0, High 2, Medium 6, Low 15, Info 3.

Rủi ro chính:
1. **TS-01 (High):** RPC tin `userId`/`role` trong payload, không có HMAC actor, không validate Zod ở tutor-service. Gateway chỉ ký payload có `actorId` (`gateway/src/features/rabbitmq/rmq.producer.ts:53-75`), `tutor_queue` không có cơ chế tương đương.
2. **TS-02 (High):** kết thúc buổi học gán `tutorId` tuỳ ý cho bài tập trước khi validate; người được gán chấm được bài của cả lớp; bài tập vẫn được ghi ngay cả khi update buổi bị từ chối.
3. **TS-03 (Medium):** mọi user đã xác thực ghi được checklist dùng chung (`apiRoutes.*`), đọc được catalog có file/line/handler.
4. **TS-05 (Medium):** payload/response RPC có số tài khoản ngân hàng được ghi vào `request_logs`; redaction thiếu.
5. **TS-04 (Medium):** mọi user tạo được conversation của cả lớp, không kiểm tra role/membership.

**Điều kiện chung:** TS-01 phụ thuộc ACL/credential broker thực tế. Nếu broker truy cập được từ ngoài mạng nội bộ, nâng TS-01 lên Critical.

## 2. Bảng tổng hợp

| ID | Mức độ | Loại | File:line | Tiêu đề |
|---|---|---|---|---|
| TS-01 | High | Security | `src/features/*/*.rpc.controller.ts` (vd `exercise.rpc.controller.ts:21-24`); không có verify actor trong `src/` | RPC tin userId/role trong payload, không HMAC, không Zod |
| TS-02 | High | Security | `src/features/session/session.service.ts:360-376, 538-543`; `session.repository.ts:196-217`; `exercise.service.ts:346, 397` | Gán tutorId tuỳ ý khi kết thúc buổi; người được gán chấm bài cả lớp |
| TS-03 | Medium | Security | `src/features/api-routes/api-routes.rpc.controller.ts:15-23`; `api-routes.repository.ts:29-45` (buildCatalog); gateway `api-routes.controller.ts:30-60` | Mọi role ghi checklist dùng chung; catalog lộ file/line |
| TS-04 | Medium | Security | `src/features/chat/conversation.service.ts:205-241` | `createClassConversation` không kiểm tra role/membership |
| TS-05 | Medium | Security | `src/packages/interceptor/trace-context.interceptor.ts:22-31, 144`; `tutor-settings.repository.ts:17-19`; `prisma/schema.prisma:784-797` | Payment/PII RPC vào `request_logs`, redaction thiếu |
| TS-06 | Medium | Security (cần xác minh) | gateway `curriculum.controller.ts:117`; `lesson.controller.ts:80,99`; `curriculum.repository.ts:72-93`; `exercise.repository.ts` canAccessFile | Lesson kèm `exerciseUrls` (R2 key) đọc được bởi mọi role |
| TS-07 | Medium | Security/Cost | `src/features/agents/agents.rpc.controller.ts:16-18`; `agents.service.ts` (chat, run, appendHistory) | `ai.chat` không quota theo user, không validate ở RPC, history Map không giới hạn |
| TS-08 | Medium | DoS | `src/features/course-progress/course-progress.rpc.controller.ts:16-18`; `course-progress.repository.ts:79, 107-110` | `courseProgress.sync` không giới hạn, N×6 query trong một transaction |
| TS-09 | Low | Bug | `src/features/class/class.repository.ts:103-125, 289-322` | Hai đường gỡ học sinh không nhất quán; `removeStudent` xoá `parentId` dù còn lớp tutor khác |
| TS-10 | Low | Bug | `src/features/chat/conversation.service.ts:423-431` (gọi từ `:372`), `:488` | Kiểm tra chat TUTOR↔PARENT chỉ xét con đầu tiên |
| TS-11 | Low | Security | `src/features/chat/chat.gateway.ts:245-264`; `message.service.ts:64-66` | `message:read` không ràng buộc messageId với conversationId |
| TS-12 | Low | Bug | `src/features/chat/conversation.service.ts:187-200` | `createGroupConversation` không dedupe participantIds (409) |
| TS-13 | Low | Bug | `src/features/agents/agents.service.ts` (getHistory) | `ai.history` limit=0/undefined trả toàn bộ history |
| TS-14 | Low | Bug | `src/features/chat/chat.gateway.ts:121, 138-140` | Presence một socket/user; đóng một tab làm offline |
| TS-15 | Low | Security | `src/main.ts:93-98` | Swagger luôn bật, không gate theo env |
| TS-16 | Low | Security | `src/packages/helpers/cors.helper.ts` (`resolveCorsOrigins`) | Ngoài production phản chiếu mọi origin + credentials |
| TS-17 | Low | Security | `src/packages/interceptor/error.interceptor.ts:35-39` | Message lỗi thô (không phải Prisma) đến client |
| TS-18 | Low | Security (latent) | `src/features/user/user.service.ts:16-25` | `getUserByField` trả cả password; cho phép dò email/phone |
| TS-19 | Low | Security | `src/features/tutor-settings/tutor-settings.rpc.controller.ts:21-28`; `tutor-settings.service.ts:75-84` | Ghi cấu hình thanh toán không kiểm tra role |
| TS-20 | Low | Security | `src/features/exercise/exercise.service.ts` (`createExerciseService`) | Học sinh gửi bài tới mọi TUTOR khi không có sessionId |
| TS-21 | Low | Security/DoS | `src/features/chat/chat.controller.ts:43-149, :85`; `conversation.service.ts:171-185` | Chat HTTP không validate; `limit` và `participantIds` không giới hạn |
| TS-22 | Low | DoS | `src/features/chat/chat.gateway.ts:145-176` | `message:send` không giới hạn content, không rate limit |
| TS-23 | Low | Architecture | `src/features/class/class.repository.ts:161-170, 315-322` | Ghi trực tiếp bảng `users` của service user |
| TS-24 | Info | Security (latent) | `src/features/dashboard/dashboard.service.ts:75-89` | `requestedRole` từ payload quyết định scope SQL |
| TS-25 | Info | Security (latent) | `src/features/tuition/tuition.repository.ts:95-99` | `findById` bỏ qua scope khi thiếu userId |
| TS-26 | Info | Security (cần xác minh) | `src/features/exercise/exercise.repository.ts` (canAccessFile) | Kiểm tra file bằng substring `position()` |

## 3. Chi tiết

**TS-01 (High).** Không có chỗ nào trong tutor-service tham chiếu `RPC_ACTOR_SECRET`/`actorSig`/`splitRpcActor` (đã grep). Không có `zod.parse`/`safeParse` trong services. `Report.assertAdminActor` và `dashboard.requestedRole` cũng dựa vào payload. Tác động: process có quyền publish lên `tutor_queue` (broker dùng chung; tài liệu local dùng `admin:admin`) có thể gọi mọi RPC với `userId`/`role` tuỳ ý, kể cả ADMIN. Đề xuất: HMAC actor như user-service; interceptor RPC toàn cục verify trước handler; ACL broker riêng từng service; Zod ở `*.rpc.controller.ts`. Cần xác minh cấu hình broker thực tế.

**TS-02 (High).** `session.service.ts:360-364` đặt `homework.tutorId = data.tutorId ?? current.tutorId`; `:372-375` gọi `assignHomeworkOnComplete` trước `applySessionUpdate` (`:376`); `resolveSessionRefs` kiểm tra role TUTOR/ADMIN chỉ ở `:538-543`. `createAssignedExercises` (`session.repository.ts:196-217`) ghi exercise với `tutorId` đó, không transaction. `session.schema.ts:70` cho phép `tutorId` uuid tuỳ ý. `gradeExerciseService` (`exercise.service.ts:397`) và `requestResubmit` (`:346`) chỉ dùng `canActOnOwned(tutorId)`, không kiểm tra role; `hideAnswerKey` coi `tutorId === userId` là chủ bài. Tác động: tutor lớp C truyền `tutorId` = một học sinh trong lớp C thì học sinh đó chấm được bài cả lớp và đọc `answerKeyUrls`, dù request trả `TUTOR_NOT_FOUND` (exercise đã persist). Truyền `tutorId` của tutor lớp khác cũng cấp quyền chấm lớp C mà không cần ADMIN. Tái hiện: `PUT session {status: COMPLETED, tutorId: <học sinh trong lớp>}` với `exerciseUrls` không rỗng, rồi học sinh gọi `exercise.grade`. Đề xuất: validate `tutorId` trước khi ghi; gộp trong `$transaction`; yêu cầu role TUTOR/ADMIN trong grade/requestResubmit; khoá đổi `tutorId` của bài đã nộp.

**TS-03 (Medium).** `api-routes.rpc.controller.ts:15-23` và `api-routes.service.ts:21` không kiểm tra role; `api-routes.repository.ts:29-45` ghi `data.doc` không giới hạn; `buildCatalog` trả file/line/handler/commits/branches. Gateway `api-routes.controller.ts:30-60` không có `@Roles` (GET catalog, GET results, PUT results/:id). Đề xuất: giới hạn ADMIN/TUTOR hoặc tắt ngoài dev; giới hạn doc; bỏ file/line ngoài dev.

**TS-04 (Medium).** `conversation.service.ts:205-241` không kiểm tra role/membership; participants được tạo ở `:236-238`; caller nhận 403 từ `assertParticipant` (`:103`) qua `getConversationById` (`:240`). Lớp không tồn tại trả 404 (`:206-209`), lớp tồn tại trả 403: dò được sự tồn tại. Tác động: user bất kỳ tạo conversation lớp với toàn bộ thành viên, gây spam. Đề xuất: kiểm tra ADMIN/tutor của lớp/học sinh đã ghi danh trước khi tạo; cùng một lỗi cho "không tồn tại" và "không có quyền".

**TS-05 (Medium).** `trace-context.interceptor.ts:22-31` `SENSITIVE_KEYS` chỉ có password/token/email/phone; `:144` log body của mọi RPC trừ `log.*`. `tutor-settings.repository.ts:17-19` và `TutorPaymentSetting` (`schema.prisma:784-797`) có `accountNumber`/`accountHolder`/`bankName`. `settings.paymentUpdate`/`paymentGet` được log vào `request_logs`. Đề xuất: mở rộng redaction hoặc không log body của `settings.*`, `apiRoutes.*`, `courseProgress.*`.

**TS-06 (Medium, cần xác minh ý đồ).** Gateway `curriculum.controller.ts:117` và `lesson.controller.ts:80,99` không có `@Roles`. `curriculum.repository.ts:72-93` không select, trả `theoryUrls`/`exerciseUrls` kèm R2 key. `class.service.ts:505-534` trả `exerciseUrls` lesson cho học sinh; `canAccessFile` (`exercise.repository.ts`) chỉ cho TUTOR tải file lesson. Nếu cùng file là bài tập buổi học, cổng "chỉ sau COMPLETED" có thể bị bỏ qua. Đề xuất: xác nhận PO; bỏ `exerciseUrls` cho non-TUTOR nếu cần; đồng bộ với `canAccessFile`.

**TS-07 (Medium).** `agents.rpc.controller.ts:16-18` và `agents.service.ts` (chat → `run(data.message)`) không có quota theo user; gateway `ai-chat.controller.ts` không `@Roles`, chỉ `@Throttle` medium 10/phút theo IP. `run()` không timeout, không `maxBudgetUsd`. Payload không qua Zod ở RPC. History Map tăng theo số user. Đề xuất: quota theo user, timeout/budget, validate ở RPC, giới hạn Map.

**TS-08 (Medium).** `course-progress.rpc.controller.ts:16-18` không validate. `course-progress.repository.ts:79` `createMany` theo `s.hist` không giới hạn; `:107-110` vòng lặp `touched` ~6 query/lesson trong một interactive transaction (timeout 5s). `Number(qKey)` có thể NaN. Đề xuất: Zod snapshot có giới hạn; gộp query; kiểm tra `lessonId` (cần xác minh FK).

**TS-09 (Low).** `class.repository.ts:103-125` (`updateWithRoster` deleteMany notIn) không dọn `tutor_id`/`parent_id`. `:289-322` `removeStudent`: `stillEnrolled` chỉ đếm cùng tutor (`:304`), rồi xoá `parentId` (`:315`) dù học sinh còn lớp tutor khác. Cần xác minh ý đồ.

**TS-10 (Low).** `conversation.service.ts:423-431` chỉ xét `findFirst` child; `:372` dùng cho TUTOR→PARENT; `getChatableUsers` (`:488`) liệt kê phụ huynh theo mọi con. Đề xuất: kiểm tra tồn tại bất kỳ con nào trong lớp của tutor.

**TS-11 (Low).** `chat.gateway.ts:245-264`; `:253` `updateMessageStatus(messageId)` không ràng buộc `conversationId` (`message.service.ts:64-66`). Đề xuất: `where {id, conversationId}`.

**TS-12 (Low).** `conversation.service.ts:187-200`; `allIds` (`:188`) không dedupe; `createMany` (`:198-200`) vi phạm unique → 409. Đề xuất: dùng `Set`.

**TS-13 (Low).** `agents.service.ts` `getHistory`: `slice(-query.limit)`; limit 0/undefined trả toàn bộ. Đề xuất: validate limit (mặc định 50), slice đúng.

**TS-14 (Low).** `chat.gateway.ts:121` `onlineUsers.set(userId, socket)`; `:138-140` delete khi bất kỳ socket disconnect. Đề xuất: giữ Set socket theo mỗi user.

**TS-15 (Low).** `main.ts:93-98` Swagger luôn bật. Đề xuất: gate theo `NODE_ENV`/`ENABLE_SWAGGER`.

**TS-16 (Low).** `cors.helper.ts` `resolveCorsOrigins` trả `NODE_ENV !== 'production'` (true) khi thiếu `CORS_ORIGINS`; dùng với credentials true. Đề xuất: bắt buộc `CORS_ORIGINS` khi có credential.

**TS-17 (Low).** `error.interceptor.ts:35-39` trả nguyên `error.message` cho lỗi không phải Prisma. Đề xuất: "Internal server error" cho lỗi không xác định.

**TS-18 (Low, latent).** `user.service.ts:16-25` `findMany` không select, trả `password`; cho phép field email/phone. Hiện chỉ `exercise.service` `studentLabel` (chỉ đọc tên). Đề xuất: select không có password; bỏ email/phone.

**TS-19 (Low).** `tutor-settings.rpc.controller.ts:21-28`; `tutor-settings.service.ts:75-84` không kiểm tra role; STUDENT/PARENT ghi được payment settings. Đề xuất: kiểm tra TUTOR/ADMIN.

**TS-20 (Low).** `exercise.service.ts` `createExerciseService`: không có `sessionId` thì học sinh chọn mọi TUTOR (`assertParties` chỉ kiểm role), kèm `issueUrls` tuỳ ý. Đề xuất: giới hạn tutor theo lớp đang học hoặc chỉ staff được đặt `issueUrls`.

**TS-21 (Low).** `chat.controller.ts:43-149` body không DTO; `:85` `parseInt` limit không cap; `message.service.ts:19` nhận limit tuỳ ý (NaN gây lỗi); `conversation.service.ts:171-185` N+1 permission. Cần xác minh chat HTTP có expose ngoài không. Đề xuất: Zod, cap limit 100, cap `participantIds` 50.

**TS-22 (Low).** `chat.gateway.ts:145-176` không kiểm tra độ dài content, không rate limit. Đề xuất: giới hạn 4000 ký tự, rate limit theo socket.

**TS-23 (Low).** `class.repository.ts:161-170` (`syncStudentsTutor`) và `:315-322` ghi bảng `users` (owner: user). Vi phạm rule "never write other service tables" và chính sách tutor-tạo-phụ-huynh của user. Đề xuất: đưa về user qua RPC hoặc ghi rõ ngoại lệ.

**TS-24 (Info).** `dashboard.service.ts:75-89` `requestedRole` từ payload; bị ảnh hưởng bởi TS-01.

**TS-25 (Info).** `tuition.repository.ts:95-99` `...(userId && canRead)`: thiếu userId thì không scope; hiện service luôn truyền userId.

**TS-26 (Info, cần xác minh).** `exercise.repository.ts` canAccessFile dùng `position(key in ::text)`: khớp substring. Rủi ro thấp nếu key là UUID; đề xuất so khớp chính xác phần tử JSON.

## 4. Đã kiểm tra và thấy ổn

- **Chat `handleConnection`** (`chat.gateway.ts:72-130`): typ access, user tồn tại + `isActive`, session `sid` live trong Redis (fail closed), tự ngắt khi token hết hạn.
- **Chat `message:send`:** `createMessage` gọi `assertParticipant` (`message.service.ts:49-50`).
- **Chat `conversation:join` và `typing:*`:** kiểm tra participant/room.
- **Raw SQL:** toàn bộ là tagged template; không có `$queryRawUnsafe`/`Prisma.raw` trong `src/`.
- **Exercise `createExerciseService`:** kiểm tra bên tham gia, không tự chấm (`studentId !== tutorId`), tutor đúng lớp và học sinh đã ghi danh khi có `sessionId`; `hideAnswerKey`; submit kiểm tra chủ bài.
- **Schedule update:** schema bỏ `classId`, repo ghi từng trường tường minh.
- **Session update:** `toSessionData` ánh xạ tường minh, không mass-assign `classId`.
- **Class create:** lấy role từ DB, chỉ TUTOR/ADMIN, TUTOR chỉ tạo cho mình; `getClass`/`getClassWatch` ẩn email/SĐT với non-owner; `getClasses` scope theo role từ DB.
- **Tuition:** `canRead` và owner check cho update/delete; `getSummary` scope đúng.
- **Attendance upsert:** owner check và học sinh thuộc roster.
- **Report:** `assertAdminActor` đọc role từ DB; gateway chỉ ADMIN (mẫu tốt, nhưng vẫn phụ thuộc payload).
- **ErrorInterceptor:** thay message Prisma bằng "Database error".
- **JwtAuthGuard:** session Redis, `isActive`, fail closed.

## 5. Hạn chế

- Không có `node_modules`: không chạy được tsc/lint/test. Toàn bộ là phân tích tĩnh.
- Chưa đọc hết: `lesson.service` (phần không liên quan quyền), `chapter.*`, `schedule.repository` (ngoài getAll/update), `session.repository` (getAll, getByClass), `tutor-settings.service` (phần teaching), `dashboard.service` (phần còn lại), `report.repository`, `class.repository` (buildUpdateData, getAllStudent), `notification.notifier`, `rmq.producer` của tutor-service, DTO ngoài các file đã trích.
- Không xác minh runtime (không có broker/DB/Redis). TS-01, TS-02, TS-08 là suy luận từ code.
- Mức độ TS-01 phụ thuộc ACL/credential broker thực tế; TS-06, TS-09, TS-10 phụ thuộc ý định nghiệp vụ.
- Đối chiếu gateway chỉ đọc; chưa review `user` và `third-service` thành đợt riêng.
- Không đọc `.env*` hay secret; không sửa source, không commit, không chạy migrate hay lệnh làm thay đổi DB.

## Mức độ theo số lượng

- Critical: 0
- High: 2 (TS-01, TS-02)
- Medium: 6 (TS-03 đến TS-08)
- Low: 15
- Info: 3 (TS-24 đến TS-26)
