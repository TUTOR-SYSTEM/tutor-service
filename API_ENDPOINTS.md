# API Endpoints

- **Base URL**: `http://localhost:8888`
- **Auth**: JWT Bearer token (except `@Public` routes)
- **Global guard**: `JwtAuthGuard` — all routes require JWT unless marked Public
- **Swagger**: `/api-docs`
- **Response interceptor**: `{ statusCode, message, data, timestamp, method, path }`
- **Error shape**: `{ success: false, statusCode, message, errors?, path, timestamp }`
- **Roles**: `All` = any authenticated role (ADMIN, TUTOR, STUDENT, PARENT). Public routes bypass auth entirely.
- **Status**: Leave empty. Fill ✅ when tested &amp; working.

---

## Common Errors


| Code | Meaning               | Trigger                                                                                                          |
| ---- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 200  | OK                    | Successful operation                                                                                             |
| 201  | Created               | Resource created                                                                                                 |
| 302  | Redirect              | Google/Facebook OAuth flow                                                                                         |
| 400  | Bad Request           | Invalid UUID, duplicate email/username, entity not found, invalid field, invalid input                           |
| 401  | Unauthorized          | Missing/invalid/expired JWT, user not found in DB                                                                |
| 403  | Forbidden             | User lacks required role (e.g. ADMIN)                                                                            |
| 404  | Not Found             | Resource not found by ID                                                                                         |
| 409  | Conflict              | Email/username/code already exists, cannot generate unique value                                                 |
| 422  | Unprocessable Entity  | Zod validation failure — `{ statusCode: 422, message: "Validation failed", errors: [{ field, message, code }] }` |
| 500  | Internal Server Error | Unhandled exception, DB constraint violation mapped by ErrorInterceptor                                          |


---

## 1. Health


| M   | Path | Auth | Scenario | Payload | Response         | Roles | Status |
| --- | ---- | ---- | -------- | ------- | ---------------- | ----- | ------ |
| GET | `/`  | JWT  | success  | —       | `"Hello World!"` | All   | Pass   |


---

## 2. Auth — `/auth`


| M    | Path                    | Auth   | Scenario             | Payload                        | Response                                                                                                                                                                                                                                                                                                                                                             | Roles                                 | Status |
| ---- | ----------------------- | ------ | -------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------ |
| POST | `/auth/register`        | Public | success              | `{ email, password, name }`    | `{ user: { id, email, username, firstName, lastName } }`                                                                                                                                                                                                                                                                                                             | —                                     |        |
| POST | `/auth/register`        | Public | 400                  | Body                           | `"Email already exists"`  • `"Username already exists"`  •  `"Failed to create user"`                                                                                                                                                                                                                                                                                    | —                                     |        |
| POST | `/auth/register`        | Public | 422: email           | `{ email }` missing/bad        | `"Email is required"`  •  `"Invalid email address"`                                                                                                                                                                                                                                                                                                                    | —                                     |        |
| POST | `/auth/register`        | Public | 422: password        | `{ password }` invalid         | `"Password is required"`  •  `"Password must be at least 6 characters"`  •  `"Password must be less than 25 characters"`  •  `"Password must include at least one lowercase letter (a-z)"`  •  `"Password must include at least one uppercase letter (A-Z)"`  •  `"Password must include at least one digit (0-9)"`  •  `"Password must include at least one special character"` | —                                     |        |
| POST | `/auth/register`        | Public | 422: firstName       | `{ firstName }` missing/bad    | `"First name is required"`  • `"First name must be less than 25 characters"`                                                                                                                                                                                                                                                                                           | —                                     |        |
| POST | `/auth/register`        | Public | 422: lastName        | `{ lastName }` missing/bad     | `"Last name is required"`  •  `"Last name must be less than 25 characters"`                                                                                                                                                                                                                                                                                            | —                                     |        |
| POST | `/auth/login`           | Public | success              | `{ email, password }`          | `{ accessToken, refreshToken, user: { id, email, userCode, username } }`                                                                                                                                                                                                                                                                                             | —                                     |        |
| POST | `/auth/login`           | Public | 400: User not found  | Body                           | `"User not found"`                                                                                                                                                                                                                                                                                                                                                   | —                                     |        |
| POST | `/auth/login`           | Public | 400: Wrong password  | Body                           | `"Invalid password"`                                                                                                                                                                                                                                                                                                                                                 | —                                     |        |
| POST | `/auth/login`           | Public | 422: email           | `{ email }` missing/bad        | `"Email is required"` • `"Invalid email address"`                                                                                                                                                                                                                                                                                                                    | —                                     |        |
| POST | `/auth/login`           | Public | 422: password        | `{ password }` invalid         | Same as register password rules                                                                                                                                                                                                                                                                                                                                      | —                                     |        |
| POST | `/auth/login/user-code` | Public | success              | `{ userCode, role: PARENT      | STUDENT }`                                                                                                                                                                                                                                                                                                                                                           | `{ accessToken, refreshToken, user }` | —      |
| POST | `/auth/login/user-code` | Public | 400                  | Body                           | `"User not found"` • `"Invalid password"`                                                                                                                                                                                                                                                                                                                            | —                                     |        |
| POST | `/auth/login/user-code` | Public | 422: userCode        | `{ userCode }` wrong length    | `"User code must be 6 characters"`                                                                                                                                                                                                                                                                                                                                   | —                                     |        |
| POST | `/auth/login/user-code` | Public | 422: role            | `{ role }` wrong value         | `"Invalid enum value. Expected 'PARENT'                                                                                                                                                                                                                                                                                                                              | 'STUDENT', received ..."`             | —      |
| POST | `/auth/login/user-code` | Public | 422: password        | `{ password }` invalid         | Same as register password rules                                                                                                                                                                                                                                                                                                                                      | —                                     |        |
| POST | `/auth/refresh`         | Public | success              | `{ refreshToken }`             | `{ accessToken, refreshToken, user }`                                                                                                                                                                                                                                                                                                                                | —                                     |        |
| POST | `/auth/refresh`         | Public | 401                  | Body                           | `"Invalid or expired refresh token"` • `"User no longer exists"`                                                                                                                                                                                                                                                                                                     | —                                     |        |
| POST | `/auth/refresh`         | Public | 422: refreshToken    | `{ refreshToken }` missing     | `"Refresh token is required"`                                                                                                                                                                                                                                                                                                                                        | —                                     |        |
| POST | `/auth/forgot-password` | Public | success              | `{ email }`                    | `{ ok: true }`                                                                                                                                                                                                                                                                                                                                                       | —                                     |        |
| POST | `/auth/forgot-password` | Public | 400                  | Body                           | `"User not found"`                                                                                                                                                                                                                                                                                                                                                   | —                                     |        |
| POST | `/auth/forgot-password` | Public | 422: email           | `{ email }` missing/bad        | `"Email is required"` • `"Invalid email address"`                                                                                                                                                                                                                                                                                                                    | —                                     |        |
| POST | `/auth/reset-password`  | JWT    | success              | `{ token, password }`          | `{ ok: true }`                                                                                                                                                                                                                                                                                                                                                       | All                                   |        |
| POST | `/auth/reset-password`  | JWT    | 400                  | Body                           | `"Invalid reset password token"` • `"User not found"` • `"User is not active"` • `"Failed to reset password"`                                                                                                                                                                                                                                                        | All                                   |        |
| POST | `/auth/reset-password`  | JWT    | 422: jti             | `{ jti }` (reset token)        | `"Reset password token is required"` • `"Invalid reset password token"`                                                                                                                                                                                                                                                                                              | All                                   |        |
| POST | `/auth/reset-password`  | JWT    | 422: password        | `{ password }` invalid         | Same as register password rules                                                                                                                                                                                                                                                                                                                                      | All                                   |        |
| POST | `/auth/reset-password`  | JWT    | 422: confirmPassword | `{ confirmPassword }` mismatch | `"Confirm password must be the same as password"`                                                                                                                                                                                                                                                                                                                    | All                                   |        |
| GET  | `/auth/google`          | Public | success              | —                              | Redirect 302 → Google OAuth                                                                                                                                                                                                                                                                                                                                          | —                                     |        |
| GET  | `/auth/google/callback` | Public | success              | —                              | Redirect 302 → frontend `?accessToken=...&refreshToken=...`                                                                                                                                                                                                                                                                                                          | —                                     |        |
| GET  | `/auth/google/callback` | Public | 400                  | —                              | `"Google account has no public email"`                                                                                                                                                                                                                                                                                                                               | —                                     |        |
| GET  | `/auth/facebook`          | Public | success              | —                              | Redirect 302 → Facebook OAuth                                                                                                                                                                                                                                                                                                                                        | —                                     |        |
| GET  | `/auth/facebook/callback` | Public | success              | —                              | Redirect 302 → frontend `?accessToken=...&refreshToken=...`                                                                                                                                                                                                                                                                                                          | —                                     |        |
| GET  | `/auth/facebook/callback` | Public | 400                  | —                              | `"Facebook account has no public email"`                                                                                                                                                                                                                                                                                                                             | —                                     |        |


---

## 3. Users — `/users`


| M      | Path                     | Auth | Scenario             | Payload                                           | Response                                                                                                                                                                                                                     | Roles        | Status   |
| ------ | ------------------------ | ---- | -------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------- |
| GET    | `/users`                 | JWT  | success              | Query: `page, limit, search?, role?, status?`     | `{ data: User[], pagination: { page, pageSize, total, totalPages } }`                                                                                                                                                        | All          |          |
| GET    | `/users`                 | JWT  | 422: page            | `page` &lt; 1 • not int                           | `"Number must be greater than or equal to 1"` • `"Expected number, received nan"`                                                                                                                                            | All          |          |
| GET    | `/users`                 | JWT  | 422: limit           | `limit` &lt; 1 or &gt; 100                        | `"Number must be greater than or equal to 1"` • `"Number must be less than or equal to 100"`                                                                                                                                 | All          |          |
| GET    | `/users`                 | JWT  | 422: role            | `role` invalid                                    | `"Invalid enum value. Expected 'ADMIN'                                                                                                                                                                                       | 'TUTOR'      | 'PARENT' |
| GET    | `/users`                 | JWT  | 422: isActive        | `isActive` not "true"/"false"                     | `"Invalid enum value"`                                                                                                                                                                                                       | All          |          |
| GET    | `/users/detail-user`     | JWT  | success              | —                                                 | Full `User` row                                                                                                                                                                                                              | All          |          |
| GET    | `/users/detail-user`     | JWT  | 400                  | —                                                 | `"User Id must be uuid"`                                                                                                                                                                                                     | All          |          |
| GET    | `/users/detail-user`     | JWT  | 404                  | —                                                 | `"User not found"`                                                                                                                                                                                                           | All          |          |
| GET    | `/users/get-by-field`    | JWT  | success              | Query: `field, value`                             | `User[]`                                                                                                                                                                                                                     | All          |          |
| GET    | `/users/get-by-field`    | JWT  | 400                  | Query                                             | `"Unsupported field: {field}"`                                                                                                                                                                                               | All          |          |
| GET    | `/users/get-by-field`    | JWT  | 422: field           | `field` missing                                   | `"Field must be string"`                                                                                                                                                                                                     | All          |          |
| GET    | `/users/get-by-field`    | JWT  | 422: value           | `value` missing                                   | `"Value must be string"`                                                                                                                                                                                                     | All          |          |
| POST   | `/users`                 | JWT  | success              | `{ email, fullName, password, role?, userCode? }` | `{ message, data: { email, fullName, password } }`                                                                                                                                                                           | All          |          |
| POST   | `/users`                 | JWT  | 400                  | Body                                              | `"Email already exists"` • `"Username already exists"` • `"Cannot generate unique username"`                                                                                                                                 | All          |          |
| POST   | `/users`                 | JWT  | 422: email           | missing/bad                                       | `"Email is required"` • `"Invalid email address"`                                                                                                                                                                            | All          |          |
| POST   | `/users`                 | JWT  | 422: firstName       | missing                                           | `"First name is required"` • `"First name must be at least 2 characters"` • `"First name must be at most 100 characters"`                                                                                                    | All          |          |
| POST   | `/users`                 | JWT  | 422: lastName        | missing/bad                                       | `"Last name is required"` • `"First name must be at least 2 characters"` (BUG: wrong field label) • `"First name must be at most 100 characters"` (BUG)                                                                      | All          |          |
| POST   | `/users`                 | JWT  | 422: password        | weak                                              | `"Password is required"` • `"Password must be at least 8 characters"` • `"Password must be at most 14 characters"` • `"...lowercase letter..."` • `"...uppercase letter..."` • `"...digit..."` • `"...special character..."` | All          |          |
| POST   | `/users`                 | JWT  | 422: avatar          | invalid url                                       | `"Avatar must be url"`                                                                                                                                                                                                       | All          |          |
| POST   | `/users`                 | JWT  | 422: classId         | not uuid                                          | `"Class Id must be uuid"`                                                                                                                                                                                                    | All          |          |
| POST   | `/users`                 | JWT  | 422: gradesId        | not uuid[]                                        | `"Class Id must be uuid"` (BUG: wrong label)                                                                                                                                                                                 | All          |          |
| PUT    | `/users`                 | JWT  | success              | `{ fullName?, phone?, address?, dob?, gender? }`  | Updated `User` row                                                                                                                                                                                                           | All          |          |
| PUT    | `/users`                 | JWT  | 400                  | Body                                              | `"User Id must be uuid"` • `"User not found"`                                                                                                                                                                                | All          |          |
| PUT    | `/users`                 | JWT  | 422: unknown keys    | extra fields not in schema                        | `"Unrecognized key(s): ..."` (schema uses `.strict()`)                                                                                                                                                                       | All          |          |
| PUT    | `/users`                 | JWT  | 422: phone           | too long                                          | `"Phone must be at most 20 characters"`                                                                                                                                                                                      | All          |          |
| PUT    | `/users`                 | JWT  | 422: description     | &gt; 5000 chars                                   | `"Description must be at most 5000 characters"`                                                                                                                                                                              | All          |          |
| PUT    | `/users`                 | JWT  | 422: subjects        | &gt; 30 chars                                     | `"Province must be at most 30 characters"` (BUG: wrong label)                                                                                                                                                                | All          |          |
| PUT    | `/users`                 | JWT  | 422: other fields    | length exceeded                                   | `"School must be at most 255 characters"` • `"Relationship must be at most 50 characters"` • `"facebookId must be at most 200 characters"`                                                                                   | All          |          |
| PUT    | `/users/:id`             | JWT  | success              | `{ fullName?, email?, phone?, role?, status? }`   | Updated `User` row                                                                                                                                                                                                           | All          |          |
| PUT    | `/users/:id`             | JWT  | 400                  | Body                                              | `"User Id must be uuid"` • `"User not found"`                                                                                                                                                                                | All          |          |
| PUT    | `/users/:id`             | JWT  | 422                  | Body invalid                                      | Same field rules as `PUT /users` above                                                                                                                                                                                       | All          |          |
| PUT    | `/users/:id/status`      | JWT  | success              | —                                                 | Updated `User` row (toggled `isActive`)                                                                                                                                                                                      | All          |          |
| PUT    | `/users/:id/status`      | JWT  | 400                  | —                                                 | `"User Id must be uuid"` • `"User not found"`                                                                                                                                                                                | All          |          |
| DELETE | `/users/:id`             | JWT  | success              | —                                                 | `{ id: string }`                                                                                                                                                                                                             | All          |          |
| DELETE | `/users/:id`             | JWT  | 400                  | —                                                 | `"User Id must be uuid"` • `"User not found"`                                                                                                                                                                                | All          |          |
| POST   | `/users/avatar`          | JWT  | success              | Multipart: `avatar`                               | `{ url, key, size, mimetype }`                                                                                                                                                                                               | All          |          |
| POST   | `/users/avatar`          | JWT  | 400                  | Multipart                                         | `"User Id must be uuid"` • `"User not found"`                                                                                                                                                                                | All          |          |
| GET    | `/users/grades`          | JWT  | success              | —                                                 | Grades list                                                                                                                                                                                                                  | ADMIN, TUTOR |          |
| PUT    | `/users/grades/:id`      | JWT  | success              | `{ name?, level? }`                               | Updated grade                                                                                                                                                                                                                | ADMIN, TUTOR |          |
| PUT    | `/users/grades/:id`      | JWT  | 400                  | Body                                              | `"Grade not found"`                                                                                                                                                                                                          | ADMIN, TUTOR |          |
| PUT    | `/users/grade`           | JWT  | success              | `{ gradeIds: string[] }`                          | Updated user grades                                                                                                                                                                                                          | ADMIN, TUTOR |          |
| PUT    | `/users/grade`           | JWT  | 400                  | Body                                              | `"One or more grade IDs are invalid"`                                                                                                                                                                                        | ADMIN, TUTOR |          |
| POST   | `/users/change-password` | JWT  | success              | `{ oldPassword, newPassword }`                    | `{ message }`                                                                                                                                                                                                                | All          |          |
| POST   | `/users/change-password` | JWT  | 400                  | Body                                              | `"User not found"`                                                                                                                                                                                                           | All          |          |
| POST   | `/users/change-password` | JWT  | 401                  | Body                                              | `"Current password is incorrect"`                                                                                                                                                                                            | All          |          |
| POST   | `/users/change-password` | JWT  | 422: currentPassword | missing                                           | `"Current password is required"`                                                                                                                                                                                             | All          |          |
| POST   | `/users/change-password` | JWT  | 422: newPassword     | weak                                              | Same as create user password rules (`min 8, max 14, + 4 complexities`)                                                                                                                                                       | All          |          |


---

## 4. Admin — `/admin`


| M      | Path                  | Auth | Scenario          | Payload                                                          | Response                                                                                                                             | Roles | Status |
| ------ | --------------------- | ---- | ----------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------ |
| POST   | `/admin/tutors`       | JWT  | success           | `{ email, firstName, lastName, password, phone?, gender?, ... }` | Created user row                                                                                                                     | ADMIN |        |
| POST   | `/admin/tutors`       | JWT  | 409               | Body                                                             | `"Email already exists: {email}"` • `"Username already exists"` • `"Cannot generate a unique user code after 5 attempts"`            | ADMIN |        |
| POST   | `/admin/tutors`       | JWT  | 422: email        | missing/bad                                                      | `"Email is required"` • `"Invalid email address"`                                                                                    | ADMIN |        |
| POST   | `/admin/tutors`       | JWT  | 422: firstName    | missing/short                                                    | `"First name is required"` • `"First name must be at least 2 characters"` • `"First name must be at most 100 characters"`            | ADMIN |        |
| POST   | `/admin/tutors`       | JWT  | 422: lastName     | missing (BUG: wrong field label in messages)                     | `"Last name is required"` • `"First name must be at least 2 characters"` (BUG) • `"First name must be at most 100 characters"` (BUG) | ADMIN |        |
| POST   | `/admin/tutors`       | JWT  | 422: password     | weak                                                             | Same as user create: `min 8, max 14, + lowercase, uppercase, digit, special`                                                         | ADMIN |        |
| POST   | `/admin/tutors`       | JWT  | 422: unknown keys | `.strict()` rejects extra fields                                 | `"Unrecognized key(s): ..."`                                                                                                         | ADMIN |        |
| POST   | `/admin/tutors`       | JWT  | 422: phone        | &gt; 20 chars                                                    | `"Phone must be at most 20 characters"`                                                                                              | ADMIN |        |
| POST   | `/admin/tutors`       | JWT  | 422: subjects     | &gt; 20 items • empty string                                     | `"At most 20 subjects allowed"` • `"Subject must not be empty"`                                                                      | ADMIN |        |
| POST   | `/admin/tutors`       | JWT  | 422: description  | &gt; 5000 chars                                                  | `"Description must be at most 5000 characters"`                                                                                      | ADMIN |        |
| POST   | `/admin/tutors`       | JWT  | 422: school       | &gt; 255 chars                                                   | `"School must be at most 255 characters"`                                                                                            | ADMIN |        |
| GET    | `/admin/tutors`       | JWT  | success           | Query: `page, limit, search?, isActive?`                         | `{ tutors: User[], pagination }`                                                                                                     | ADMIN |        |
| GET    | `/admin/tutors`       | JWT  | 422: page         | &lt; 1 • not int                                                 | `"Number must be greater than or equal to 1"`                                                                                        | ADMIN |        |
| GET    | `/admin/tutors`       | JWT  | 422: limit        | &lt; 1 or &gt; 100                                               | `"Number must be greater than or equal to 1"` • `"Number must be less than or equal to 100"`                                         | ADMIN |        |
| GET    | `/admin/tutors`       | JWT  | 422: isActive     | not "true"/"false"                                               | `"Invalid enum value"`                                                                                                               | ADMIN |        |
| GET    | `/admin/tutors/:id`   | JWT  | success           | —                                                                | Single user row                                                                                                                      | ADMIN |        |
| GET    | `/admin/tutors/:id`   | JWT  | 400               | —                                                                | `"Invalid id"`                                                                                                                       | ADMIN |        |
| GET    | `/admin/tutors/:id`   | JWT  | 404               | —                                                                | `"Tutor not found"`                                                                                                                  | ADMIN |        |
| PUT    | `/admin/tutors/:id`   | JWT  | success           | `{ email?, firstName?, lastName?, phone?, subjects?, ... }`      | Updated user row                                                                                                                     | ADMIN |        |
| PUT    | `/admin/tutors/:id`   | JWT  | 400/404/409       | Body                                                             | `"Invalid id"` • `"Tutor not found"` • `"Email already exists"` • `"Username already exists"`                                        | ADMIN |        |
| PUT    | `/admin/tutors/:id`   | JWT  | 422               | Body invalid                                                     | Same field rules as `POST /admin/tutors` (all optional) + avatar: `"Avatar must be a url"`                                           | ADMIN |        |
| DELETE | `/admin/tutors/:id`   | JWT  | success           | —                                                                | `{ id: string }`                                                                                                                     | ADMIN |        |
| DELETE | `/admin/tutors/:id`   | JWT  | 400/404           | —                                                                | `"Invalid id"` • `"Tutor not found"`                                                                                                 | ADMIN |        |
| POST   | `/admin/students`     | JWT  | success           | `{ email, firstName, lastName, password, ... }`                  | Created user row                                                                                                                     | ADMIN |        |
| POST   | `/admin/students`     | JWT  | 409               | Body                                                             | `"Email already exists"` • `"Username already exists"` • `"Cannot generate..."`                                                      | ADMIN |        |
| POST   | `/admin/students`     | JWT  | 422               | Body invalid                                                     | Same field rules as `POST /admin/tutors`                                                                                             | ADMIN |        |
| GET    | `/admin/students`     | JWT  | success           | Query: `page, limit, search?, isActive?`                         | `{ students: User[], pagination }`                                                                                                   | ADMIN |        |
| GET    | `/admin/students`     | JWT  | 422               | Query invalid                                                    | Same rules as `GET /admin/tutors`                                                                                                    | ADMIN |        |
| GET    | `/admin/students/:id` | JWT  | success           | —                                                                | Single user row                                                                                                                      | ADMIN |        |
| GET    | `/admin/students/:id` | JWT  | 400/404           | —                                                                | `"Invalid id"` • `"Student not found"`                                                                                               | ADMIN |        |
| PUT    | `/admin/students/:id` | JWT  | success           | `{ email?, firstName?, lastName?, ... }`                         | Updated user row                                                                                                                     | ADMIN |        |
| PUT    | `/admin/students/:id` | JWT  | 400/404/409       | Body                                                             | `"Invalid id"` • `"Student not found"` • `"Email already exists"` • `"Username already exists"`                                      | ADMIN |        |
| PUT    | `/admin/students/:id` | JWT  | 422               | Body invalid                                                     | Same field rules as `POST /admin/students` (all optional)                                                                            | ADMIN |        |
| DELETE | `/admin/students/:id` | JWT  | success           | —                                                                | `{ id: string }`                                                                                                                     | ADMIN |        |
| DELETE | `/admin/students/:id` | JWT  | 400/404           | —                                                                | `"Invalid id"` • `"Student not found"`                                                                                               | ADMIN |        |


---

## 5. Classes — `/class`


| M      | Path                     | Auth | Scenario               | Payload                                                                | Response                                                                                                                                            | Roles       | Status       |
| ------ | ------------------------ | ---- | ---------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------ |
| POST   | `/class/create`          | JWT  | success                | `{ name, subject?, description?, maxStudents?, startDate?, endDate? }` | Created class row                                                                                                                                   | All         |              |
| POST   | `/class/create`          | JWT  | 400                    | Body                                                                   | `"Name class is exist"` • `"Code class is exist"` • `"User Id must be uuid"` • `"User not found"` • `"Tutor Id must be uuid"` • `"Tutor not found"` | All         |              |
| POST   | `/class/create`          | JWT  | 422: name              | missing • &gt; 255 chars                                               | `"Name is required"` • `"Name too long"`                                                                                                            | All         |              |
| POST   | `/class/create`          | JWT  | 422: code              | missing • &gt; 50 chars                                                | Zod default                                                                                                                                         | All         |              |
| POST   | `/class/create`          | JWT  | 422: subject           | missing • &gt; 255 chars                                               | `"Subject is required"` • `"Subject too long"`                                                                                                      | All         |              |
| POST   | `/class/create`          | JWT  | 422: tuition           | &lt; 0                                                                 | `"Number must be greater than or equal to 0"`                                                                                                       | All         |              |
| POST   | `/class/create`          | JWT  | 422: status            | invalid enum                                                           | `"Invalid enum value. Expected 'OPEN'                                                                                                               | 'CLOSED'    | 'UPCOMING'"` |
| POST   | `/class/create`          | JWT  | 422: format            | invalid enum                                                           | `"Invalid enum value. Expected 'ONLINE'                                                                                                             | 'OFFLINE'"` | All          |
| POST   | `/class/create`          | JWT  | 422: startTime/endTime | invalid date                                                           | `"Start time must be a valid date"` • `"End time must be a valid date"`                                                                             | All         |              |
| POST   | `/class/create`          | JWT  | 422: tutorId           | missing • not uuid                                                     | `"Tutor ID is required"` • `"Invalid tutor ID"`                                                                                                     | All         |              |
| POST   | `/class/create`          | JWT  | 422: curriculumId      | not uuid                                                               | `"Invalid curriculum ID"`                                                                                                                           | All         |              |
| POST   | `/class/create`          | JWT  | 422: schedulesId       | not uuid[]                                                             | `"Schedules Id must be uuid"`                                                                                                                       | All         |              |
| GET    | `/class/generateCode`    | JWT  | success                | —                                                                      | `{ code: string }`                                                                                                                                  | All         |              |
| GET    | `/class/generateCode`    | JWT  | 409                    | —                                                                      | `"Unable to generate unique code, please try again"`                                                                                                | All         |              |
| GET    | `/class/getAll`          | JWT  | success                | Query: `page, limit, search?, status?, subject?`                       | Paginated class list                                                                                                                                | All         |              |
| GET    | `/class/getAll`          | JWT  | 422: page/limit        | same as users                                                          | `"Number must be >= 1"` • `"<= 100"`                                                                                                                | All         |              |
| GET    | `/class/getAll`          | JWT  | 422: status            | invalid                                                                | `"Invalid enum value. Expected 'OPEN'                                                                                                               | 'CLOSED'    | 'UPCOMING'"` |
| GET    | `/class/getAll`          | JWT  | 422: studentsId        | not uuid                                                               | `"Invalid student ID"`                                                                                                                              | All         |              |
| GET    | `/class/getById/:id`     | JWT  | success                | —                                                                      | `ClassDetailDto`                                                                                                                                    | All         |              |
| GET    | `/class/getById/:id`     | JWT  | 404                    | —                                                                      | `"Class not found"`                                                                                                                                 | All         |              |
| PUT    | `/class/update/:id`      | JWT  | success                | Partial of POST body (no `tutorId`) + `studentIds?` (&lt;= 100, reconciles enrollment) | Updated class row                                                                                                          | All         |              |
| PUT    | `/class/update/:id`      | JWT  | 400                    | Body                                                                   | `"Class not found"` (also on ownership mismatch) • `"Class name already exists"` • `"Class code already exists"` • `"Student not found: {id}"` • `"User is not a student: {id}"` | All |    |
| PUT    | `/class/update/:id`      | JWT  | 422                    | Body invalid                                                           | Same field rules as `POST /classes` (all optional, no `tutorId`)                                                                                    | All         |              |
| POST   | `/class/addStudents/:id` | JWT  | success                | `{ studentIds: string[] }`                                             | Added students                                                                                                                                      | All         |              |
| POST   | `/class/addStudents/:id` | JWT  | 400                    | Body                                                                   | `"Student not found: {id}"` • `"User is not a student: {id}"` • UUID errors                                                                         | All         |              |
| POST   | `/class/addStudents/:id` | JWT  | 404                    | Body                                                                   | `"Class not found"`                                                                                                                                 | All         |              |
| POST   | `/class/addStudents/:id` | JWT  | 422: studentIds        | &lt; 1 • &gt; 100 • not uuid                                           | `"At least 1 student is required"` • `"At most 100 students at once"` • `"Invalid student ID"`                                                      | All         |              |
| GET    | `/class/getStudents/:id` | JWT  | success                | —                                                                      | Students in class                                                                                                                                   | All         |              |
| GET    | `/class/getStudents/:id` | JWT  | 400/404                | —                                                                      | UUID errors • `"User not exist"` • `"Class not found"`                                                                                              | All         |              |
| GET    | `/class/getMaterials/:id` | JWT  | success                | —                                                                      | Theory + exercise materials                                                                                                                         | All         |              |
| GET    | `/class/getMaterials/:id` | JWT  | 400/404                | —                                                                      | UUID errors • `"User not exist"` • `"Class not found"`                                                                                              | All         |              |
| DELETE | `/class/delete/:id`      | JWT  | success                | —                                                                      | Deletion result                                                                                                                                     | All         |              |
| DELETE | `/class/delete/:id`      | JWT  | 400/404                | —                                                                      | UUID errors • `"User not exist"` • `"Class not found"`                                                                                              | All         |              |


---

## 6. Students — `/students`


| M      | Path                         | Auth | Scenario                | Payload                                                                             | Response                                                                         | Roles    | Status       |
| ------ | ---------------------------- | ---- | ----------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------- | ------------ |
| GET    | `/students/get-student-code` | JWT  | success                 | —                                                                                   | Generated student code (string)                                                  | All      |              |
| GET    | `/students/get-student-code` | JWT  | 409                     | —                                                                                   | `"Unable to generate unique code, please try again"`                             | All      |              |
| POST   | `/students`                  | JWT  | success                 | `{ fullName, dob?, gender?, address?, parentName?, parentPhone?, note?, classId? }` | Created student user row                                                         | All      |              |
| POST   | `/students`                  | JWT  | 409                     | Body                                                                                | `"Student code {code} already exists"` • `"Cannot generate unique username"`     | All      |              |
| POST   | `/students`                  | JWT  | 422: studentName        | missing • &gt; 255                                                                  | `"Student name must be required"` • `"Student name must not over 255 character"` | All      |              |
| POST   | `/students`                  | JWT  | 422: email              | invalid                                                                             | `"Invalid email"`                                                                | All      |              |
| POST   | `/students`                  | JWT  | 422: parentName         | &gt; 255                                                                            | `"Parent name must not over 255 character"`                                      | All      |              |
| POST   | `/students`                  | JWT  | 422: parentEmail        | invalid                                                                             | `"Invalid parent email"`                                                         | All      |              |
| POST   | `/students`                  | JWT  | 422: parentRelationship | invalid enum                                                                        | `"Invalid enum value. Expected 'FATHER'                                          | 'MOTHER' | 'GUARDIAN'"` |
| POST   | `/students`                  | JWT  | 422: gender             | invalid enum                                                                        | `"Invalid enum value. Expected 'MALE'                                            | 'FEMALE' | 'OTHER'"`    |
| POST   | `/students`                  | JWT  | 422: userCode           | &gt; 50 chars                                                                       | `"Code too long"`                                                                | All      |              |
| POST   | `/students`                  | JWT  | 422: studentPhone       | &gt; 20 chars                                                                       | Zod default                                                                      | All      |              |
| GET    | `/students`                  | JWT  | success                 | Query: `page, limit, search?, classId?, tutorId?`                                   | Paginated students                                                               | All      |              |
| GET    | `/students`                  | JWT  | 422: page/limit         | out of range                                                                        | Same as users                                                                    | All      |              |
| GET    | `/students`                  | JWT  | 422: classId            | not uuid                                                                            | Zod default                                                                      | All      |              |
| GET    | `/students`                  | JWT  | 422: tutorId            | not uuid                                                                            | `"Invalid tutor ID"`                                                             | All      |              |
| GET    | `/students/:id`              | JWT  | success                 | —                                                                                   | `StudentResponseDto`                                                             | All      |              |
| GET    | `/students/:id`              | JWT  | 404                     | —                                                                                   | `"Student not found"`                                                            | All      |              |
| PUT    | `/students/:id`              | JWT  | success                 | `{ fullName?, dob?, gender?, address?, note? }`                                     | Updated user row                                                                 | All      |              |
| PUT    | `/students/:id`              | JWT  | 404                     | Body                                                                                | `"Student not found"`                                                            | All      |              |
| PUT    | `/students/:id`              | JWT  | 422                     | Body invalid                                                                        | Same field rules as `POST /students` (all optional) + avatar: url format         | All      |              |
| DELETE | `/students/:id`              | JWT  | success                 | —                                                                                   | `{ id: string }`                                                                 | All      |              |
| DELETE | `/students/:id`              | JWT  | 404                     | —                                                                                   | `"Student not found"`                                                            | All      |              |


---

## 7. Sessions — `/session`


| M      | Path                       | Auth | Scenario           | Payload                                                                  | Response                                                                                     | Roles     | Status      |
| ------ | -------------------------- | ---- | ------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | --------- | ----------- |
| POST   | `/session/create`          | JWT  | success            | `{ classId, title?, date, startTime, endTime, description?, location?, objectives?, agenda?, exerciseDueAt? }` | Created session                                                                              | All       |             |
| POST   | `/session/create`          | JWT  | 400/404            | Body                                                                     | `"Class Id must be uuid"` • `"Class not found"` • `"Lesson not found"` • `"Tutor not found"` | All       |             |
| POST   | `/session/create`          | JWT  | 422: classId       | not uuid                                                                 | `"Invalid class ID"`                                                                         | All       |             |
| POST   | `/session/create`          | JWT  | 422: sessionNumber | missing • &lt; 1                                                         | `"Session number must be >= 1"`                                                              | All       |             |
| POST   | `/session/create`          | JWT  | 422: startAt/endAt | invalid date                                                             | `"Start time must be a valid date"` • `"End time must be a valid date"`                      | All       |             |
| POST   | `/session/create`          | JWT  | 422: title         | &gt; 255 chars                                                           | `"Title too long"`                                                                           | All       |             |
| POST   | `/session/create`          | JWT  | 422: lessonId      | not uuid                                                                 | `"Invalid lesson ID"`                                                                        | All       |             |
| POST   | `/session/create`          | JWT  | 422: status        | invalid enum                                                             | `"Invalid enum value. Expected 'SCHEDULED'                                                   | 'ONGOING' | 'COMPLETED' |
| POST   | `/session/createBulk`      | JWT  | success            | `{ classId, sessions: Array<{...}> }`                                    | Created sessions (array)                                                                     | All       |             |
| POST   | `/session/createBulk`      | JWT  | 400/404            | Body                                                                     | Same as single session                                                                       | All       |             |
| POST   | `/session/createBulk`      | JWT  | 422: sessions      | &lt; 1 or &gt; 50 items                                                  | `"At least 1 session is required"` • `"At most 50 sessions allowed"`                         | All       |             |
| POST   | `/session/createBulk`      | JWT  | 422: items         | invalid per-item                                                         | Same field rules as `POST /sessions` per-item                                                | All       |             |
| GET    | `/session/getAll`          | JWT  | success            | Query: `page, limit, search?, status?`                                   | Paginated sessions                                                                           | All       |             |
| GET    | `/session/getAll`          | JWT  | 422: page/limit    | out of range                                                             | Same as users                                                                                | All       |             |
| GET    | `/session/getAll`          | JWT  | 422: status        | invalid enum                                                             | `"Invalid enum value"` (SCHEDULED/ONGOING/COMPLETED/CANCELLED/POSTPONED)                     | All       |             |
| GET    | `/session/getAll`          | JWT  | 422: classId       | not uuid                                                                 | `"Invalid class ID"`                                                                         | All       |             |
| GET    | `/session/getByClass/:classId` | JWT  | success            | —                                                                        | Sessions by class                                                                            | All       |             |
| GET    | `/session/getByClass/:classId` | JWT  | 400/404            | —                                                                        | UUID errors • `"Class not found"`                                                            | All       |             |
| GET    | `/session/getById/:id`     | JWT  | success            | —                                                                        | Session detail                                                                               | All       |             |
| GET    | `/session/getById/:id`     | JWT  | 400/404            | —                                                                        | UUID errors • `"Session not found"`                                                          | All       |             |
| PUT    | `/session/update/:id`      | JWT  | success            | `{ title?, date?, startTime?, endTime?, status?, objectives?, agenda?, exerciseDueAt?, ... }` | Updated session                                                                              | All       |             |
| PUT    | `/session/update/:id`      | JWT  | 400/404            | Body                                                                     | UUID errors • `"Session not found"`                                                          | All       |             |
| PUT    | `/session/update/:id`      | JWT  | 422                | Body invalid                                                             | Same field rules as `POST /sessions` (all optional)                                          | All       |             |
| DELETE | `/session/delete/:id`      | JWT  | success            | —                                                                        | Deletion result                                                                              | All       |             |
| DELETE | `/session/delete/:id`      | JWT  | 400/404            | —                                                                        | UUID errors • `"Session not found"`                                                          | All       |             |

Notes: `objectives: string[]` (checklist "Mục tiêu buổi học"), `agenda: { time, title, description? }[]`
(timestamped "Nội dung buổi học"), `exerciseDueAt: string | null` (ISO date-time, "Hạn nộp bài tập về
nhà") — all optional, default `[]`/`null`, not yet rendered by any FE page as of 2026-08-29.


---

## 8. Schedules — `/schedule`


| M      | Path                        | Auth | Scenario               | Payload                                                   | Response                                                                    | Roles       | Status |
| ------ | --------------------------- | ---- | ---------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- | ----------- | ------ |
| POST   | `/schedule/create`          | JWT  | success                | `{ classId, dayOfWeek (1-7), startTime, endTime, room? }` | Created schedule                                                            | All         |        |
| POST   | `/schedule/create`          | JWT  | 400/404                | Body                                                      | `"Class Id must be uuid"` • `"Class not found"`                             | All         |        |
| POST   | `/schedule/create`          | JWT  | 422: classId           | not uuid                                                  | `"Invalid class ID"`                                                        | All         |        |
| POST   | `/schedule/create`          | JWT  | 422: dayOfWeek         | invalid enum                                              | `"Invalid enum value. Expected 'MONDAY'                                     | 'TUESDAY'   | ...    |
| POST   | `/schedule/create`          | JWT  | 422: startTime/endTime | bad format                                                | `"Invalid time format (HH:mm)"`                                             | All         |        |
| POST   | `/schedule/create`          | JWT  | 422: format            | invalid enum                                              | `"Invalid enum value. Expected 'ONLINE'                                     | 'OFFLINE'"` | All    |
| POST   | `/schedule/createBulk`      | JWT  | success                | `{ classId, schedules: Array<{...}> }`                    | Created schedules (array, 1-7)                                              | All         |        |
| POST   | `/schedule/createBulk`      | JWT  | 400/404                | Body                                                      | Same as single schedule                                                     | All         |        |
| POST   | `/schedule/createBulk`      | JWT  | 422: schedules         | &lt; 1 or &gt; 7 items                                    | `"At least 1 schedule is required"` • `"At most 7 schedules allowed"`       | All         |        |
| POST   | `/schedule/createBulk`      | JWT  | 422: items             | invalid per-item                                          | Same field rules as `POST /schedules` per-item                              | All         |        |
| GET    | `/schedule/getAll`          | JWT  | success                | Query: `page, limit, search?, classId?`                   | Paginated schedules                                                         | All         |        |
| GET    | `/schedule/getAll`          | JWT  | 422: page/limit        | out of range                                              | Same as users                                                               | All         |        |
| GET    | `/schedule/getAll`          | JWT  | 422: classId           | not uuid                                                  | `"Invalid class ID"`                                                        | All         |        |
| GET    | `/schedule/getByClass/:classId` | JWT  | success                | —                                                         | Schedules by class                                                          | All         |        |
| GET    | `/schedule/getByClass/:classId` | JWT  | 400/404                | —                                                         | UUID errors • `"Class not found"`                                           | All         |        |
| GET    | `/schedule/getById/:id`     | JWT  | success                | —                                                         | Schedule detail                                                             | All         |        |
| GET    | `/schedule/getById/:id`     | JWT  | 400/404                | —                                                         | UUID errors • `"Schedule not found"`                                        | All         |        |
| PATCH  | `/schedule/update/:id`      | JWT  | success                | `{ dayOfWeek?, startTime?, endTime?, room? }`             | Updated schedule                                                            | All         |        |
| PATCH  | `/schedule/update/:id`      | JWT  | 400/404                | Body                                                      | UUID errors • `"Schedule not found"`                                        | All         |        |
| PATCH  | `/schedule/update/:id`      | JWT  | 422                    | Body invalid                                              | Same field rules as `POST /schedules` (all optional except classId removed) | All         |        |
| DELETE | `/schedule/delete/:id`      | JWT  | success                | —                                                         | Deletion result                                                             | All         |        |
| DELETE | `/schedule/delete/:id`      | JWT  | 400/404                | —                                                         | UUID errors • `"Schedule not found"`                                        | All         |        |


---

## 9. Curriculum — `/curriculum`


| M      | Path                        | Auth | Scenario        | Payload                                                         | Response                                                                                        | Roles | Status |
| ------ | --------------------------- | ---- | --------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----- | ------ |
| GET    | `/curriculum/generateCode`  | JWT  | success         | —                                                               | Curriculum code (string)                                                                        | All   |        |
| GET    | `/curriculum/generateCode`  | JWT  | 409             | —                                                               | `"Unable to generate unique code, please try again"`                                            | All   |        |
| POST   | `/curriculum/create`        | JWT  | success         | `{ code, name, description?, subject?, grade?, isActive? }`     | Created curriculum                                                                              | All   |        |
| POST   | `/curriculum/create`        | JWT  | 400             | Body                                                            | `"userId must be uuid"` • `"User not found"`                                                    | All   |        |
| POST   | `/curriculum/create`        | JWT  | 422             | **BUG: No ZodValidationPipe wired** — no 422 from this endpoint | —                                                                                               | All   |        |
| GET    | `/curriculum/getAll`        | JWT  | success         | Query: `page, limit, search?`                                   | Paginated curricula                                                                             | All   |        |
| GET    | `/curriculum/getAll`        | JWT  | 422: page/limit | **BUG: Uses wallet schema** — same page/limit rules as others   | Same as users                                                                                   | All   |        |
| GET    | `/curriculum/getById/:id`   | JWT  | success         | —                                                               | Curriculum detail                                                                               | All   |        |
| GET    | `/curriculum/getById/:id`   | JWT  | 400/404         | —                                                               | `"userId not uuid"` • `"Invalid curriculum id"` • `"User not found"` • `"Curriculum not found"` | All   |        |
| PUT    | `/curriculum/update/:id`    | JWT  | success         | `{ code?, name?, description?, subject?, grade?, isActive? }`   | Updated curriculum                                                                              | All   |        |
| PUT    | `/curriculum/update/:id`    | JWT  | 400/404         | Body                                                            | UUID errors • `"User not found"` • `"Curriculum not found"`                                     | All   |        |
| PUT    | `/curriculum/update/:id`    | JWT  | 422             | **BUG: No ZodValidationPipe wired** — no 422 from this endpoint | —                                                                                               | All   |        |
| DELETE | `/curriculum/delete/:id`    | JWT  | success         | —                                                               | Deletion result                                                                                 | All   |        |
| DELETE | `/curriculum/delete/:id`    | JWT  | 400/404         | —                                                               | UUID errors • `"User not found"` • `"Curriculum not found"`                                     | All   |        |


---

## 10. Chapter — `/chapter`


| M      | Path                     | Auth | Scenario          | Payload                                       | Response                                                         | Roles | Status |
| ------ | ------------------------ | ---- | ----------------- | --------------------------------------------- | ---------------------------------------------------------------- | ----- | ------ |
| POST   | `/chapter/create/:curriculumId` | JWT  | success           | `{ name, description?, order? }`              | Created chapter                                                  | All   |        |
| POST   | `/chapter/create/:curriculumId` | JWT  | 400/404           | Body                                          | `"curriculumId must be a valid UUID"` • `"Curriculum not found"` | All   |        |
| POST   | `/chapter/create/:curriculumId` | JWT  | 422: title        | missing • &gt; 255                            | `"Title is required"` • `"Title too long"`                       | All   |        |
| POST   | `/chapter/create/:curriculumId` | JWT  | 422: order        | invalid int                                   | Zod default                                                      | All   |        |
| GET    | `/chapter/getAll`        | JWT  | success           | Query: `curriculumId (required), page, limit` | Paginated chapters                                               | All   |        |
| GET    | `/chapter/getAll`        | JWT  | 400               | Query                                         | `"curriculumId must be a valid UUID"`                            | All   |        |
| GET    | `/chapter/getAll`        | JWT  | 422: curriculumId | missing                                       | `"Invalid curriculum ID"`                                        | All   |        |
| GET    | `/chapter/getAll`        | JWT  | 422: page/limit   | out of range                                  | Same as users                                                    | All   |        |
| GET    | `/chapter/getById/:id`   | JWT  | success           | —                                             | Chapter detail                                                   | All   |        |
| GET    | `/chapter/getById/:id`   | JWT  | 400/404           | —                                             | `"Invalid chapter id"` • `"Chapter not found"`                   | All   |        |
| PUT    | `/chapter/update/:id`    | JWT  | success           | `{ name?, description?, order? }`             | Updated chapter                                                  | All   |        |
| PUT    | `/chapter/update/:id`    | JWT  | 400/404           | Body                                          | `"Invalid chapter id"` • `"Chapter not found"`                   | All   |        |
| PUT    | `/chapter/update/:id`    | JWT  | 422               | Body invalid                                  | Same field rules as `POST /chapter` (all optional)               | All   |        |
| DELETE | `/chapter/delete/:id`    | JWT  | success           | —                                             | Deletion result                                                  | All   |        |
| DELETE | `/chapter/delete/:id`    | JWT  | 400/404           | —                                             | `"Invalid chapter id"` • `"Chapter not found"`                   | All   |        |


---

## 11. Lesson — `/curriculum/lessons`


| M      | Path                                        | Auth | Scenario                     | Payload                                                                            | Response                                                                                                                  | Roles | Status |
| ------ | ------------------------------------------- | ---- | ---------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| POST   | `/lesson/create`                            | JWT  | success                      | Query: `curriculumId, chapterId?`; Body: `{ name, content?, order?, lessonType? }` | Created lesson                                                                                                            | All   |        |
| POST   | `/lesson/create`                            | JWT  | 400                          | Query/Body                                                                         | `"curriculumId must be a valid UUID"` • `"chapterId must be a valid UUID"`                                                | All   |        |
| POST   | `/lesson/create`                            | JWT  | 422: title                   | missing • &gt; 255                                                                 | `"Title is required"` • `"Title too long"`                                                                                | All   |        |
| POST   | `/lesson/create`                            | JWT  | 422: theoryUrls/exerciseUrls | invalid format                                                                     | `"File name is required"` • `"Invalid URL"` • `"File key is required"` per item                                           | All   |        |
| POST   | `/lesson/create`                            | JWT  | 422: order                   | invalid int                                                                        | Zod default                                                                                                               | All   |        |
| GET    | `/lesson/getAll`                            | JWT  | success                      | Query: `curriculumId (required), chapterId?, page, limit`                          | Paginated lessons                                                                                                         | All   |        |
| GET    | `/lesson/getAll`                            | JWT  | 400                          | Query                                                                              | `"curriculumId must be a valid UUID"` • `"chapterId must be a valid UUID"`                                                | All   |        |
| GET    | `/lesson/getAll`                            | JWT  | 422: curriculumId            | missing                                                                            | `"Invalid curriculum ID"`                                                                                                 | All   |        |
| GET    | `/lesson/getAll`                            | JWT  | 422: page/limit              | out of range                                                                       | Same as users                                                                                                             | All   |        |
| GET    | `/lesson/getById/:id`                       | JWT  | success                      | —                                                                                  | Lesson detail                                                                                                             | All   |        |
| GET    | `/lesson/getById/:id`                       | JWT  | 400/404                      | —                                                                                  | `"Invalid lesson id"` • `"Lesson not found"`                                                                              | All   |        |
| PUT    | `/lesson/update/:id`                        | JWT  | success                      | `{ name?, content?, order?, lessonType? }`                                         | Updated lesson                                                                                                            | All   |        |
| PUT    | `/lesson/update/:id`                        | JWT  | 400/404                      | Body                                                                               | `"Invalid lesson id"` • `"Lesson not found"`                                                                              | All   |        |
| PUT    | `/lesson/update/:id`                        | JWT  | 422                          | Body invalid                                                                       | Same field rules as `POST /curriculum/lessons` (all optional)                                                             | All   |        |
| DELETE | `/lesson/delete/:id`                        | JWT  | success                      | —                                                                                  | Deletion result                                                                                                           | All   |        |
| DELETE | `/lesson/delete/:id`                        | JWT  | 400/404                      | —                                                                                  | `"Invalid lesson id"` • `"Lesson not found"`                                                                              | All   |        |
| PUT    | `/curriculum/lessons/:id/add-theory`        | JWT  | success                      | Multipart: `file`                                                                  | Updated lesson with theory file                                                                                           | All   |        |
| PUT    | `/curriculum/lessons/:id/add-theory`        | JWT  | 400                          | Multipart                                                                          | `"userId must be uuid"` • `"Invalid lesson id"` • `"User not found"` • `"Lesson not found"` • `"Upload theory failed"`    | All   |        |
| PUT    | `/curriculum/lessons/:id/exercises`         | JWT  | success                      | Multipart: `file`                                                                  | Updated lesson with exercise file                                                                                         | All   |        |
| PUT    | `/curriculum/lessons/:id/exercises`         | JWT  | 400                          | Multipart                                                                          | `"userId must be uuid"` • `"Invalid lesson id"` • `"User not found"` • `"Lesson not found"` • `"Upload exercises failed"` | All   |        |
| DELETE | `/curriculum/lessons/:id/add-theory`        | JWT  | success                      | `{ url?, key? }`                                                                   | Updated lesson with theory file removed                                                                                   | All   |        |
| DELETE | `/curriculum/lessons/:id/add-theory`        | JWT  | 400/404                      | Body                                                                               | `"userId must be uuid"` • `"Invalid lesson id"` • `"User not found"` • `"Lesson not found"`                               | All   |        |
| DELETE | `/curriculum/lessons/:id/exercises`         | JWT  | success                      | `{ url?, key? }`                                                                   | Updated lesson with exercise file removed                                                                                 | All   |        |
| DELETE | `/curriculum/lessons/:id/exercises`         | JWT  | 400/404                      | Body                                                                               | `"userId must be uuid"` • `"Invalid lesson id"` • `"User not found"` • `"Lesson not found"`                               | All   |        |


---

## 12. Exercises — `/exercise`


| M     | Path                    | Auth | Scenario          | Payload                                                          | Response                                                                                                               | Roles | Status |
| ----- | ----------------------- | ---- | ----------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| POST  | `/exercise/create`      | JWT  | success           | `{ sessionId, studentId?, content?, attachments? }`              | Created exercise                                                                                                       | All   |        |
| POST  | `/exercise/create`      | JWT  | 400/404/409       | Body                                                             | `"{field} must be a valid UUID"` • `"{field} not found"` • `"Exercise already submitted for this session"`             | All   |        |
| POST  | `/exercise/create`      | JWT  | 422: tutorId      | missing • not uuid                                               | `"tutorId must be uuid"`                                                                                               | All   |        |
| POST  | `/exercise/create`      | JWT  | 422: sessionId    | not uuid                                                         | `"Session id must be uuid"`                                                                                            | All   |        |
| POST  | `/exercise/create`      | JWT  | 422: lessonId     | not uuid                                                         | `"Lesson id must be uuid"`                                                                                             | All   |        |
| POST  | `/exercise/create`      | JWT  | 422: studentId    | missing • not uuid                                               | `"studentId Id must be uuid"`                                                                                          | All   |        |
| GET   | `/exercise/getAll`      | JWT  | success           | Query: `page, limit, sessionId?, studentId?, classId?, tutorId?` | Paginated exercises                                                                                                    | All   |        |
| GET   | `/exercise/getAll`      | JWT  | 422: page/limit   | out of range                                                     | Same as users                                                                                                          | All   |        |
| GET   | `/exercise/getAll`      | JWT  | 422: filters      | not uuid                                                         | Zod default                                                                                                            | All   |        |
| GET   | `/exercise/getById/:id` | JWT  | success           | —                                                                | `ExerciseDetailDto`                                                                                                    | All   |        |
| GET   | `/exercise/getById/:id` | JWT  | 404               | —                                                                | `"Exercise not found"`                                                                                                 | All   |        |
| PATCH | `/exercise/submit/:id`  | JWT  | success           | `{ content?, attachments? }`                                     | Resubmitted exercise                                                                                                   | All   |        |
| PATCH | `/exercise/submit/:id`  | JWT  | 400/403/404       | Body                                                             | `"Exercise already graded — cannot re-submit"` • `"You can only re-submit your own exercise"` • `"Exercise not found"` | All   |        |
| PATCH | `/exercise/submit/:id`  | JWT  | 422: exerciseUrls | missing • empty                                                  | `"Cần ít nhất một tệp bài làm"` (Vietnamese)                                                                           | All   |        |
| PATCH | `/exercise/grade/:id`   | JWT  | success           | `{ score, comment? }`                                            | Graded exercise                                                                                                        | All   |        |
| PATCH | `/exercise/grade/:id`   | JWT  | 403/404           | Body                                                             | `"Only the assigned tutor can grade this exercise"` • `"Exercise not found"`                                           | All   |        |
| PATCH | `/exercise/grade/:id`   | JWT  | 422: score        | &lt; 0 or &gt; 10                                                | `"Điểm tối thiểu là 0"` • `"Điểm tối đa là 10"` (Vietnamese)                                                           | All   |        |
| PATCH | `/exercise/grade/:id`   | JWT  | 422: comment      | &gt; 2000 chars                                                  | Zod default                                                                                                            | All   |        |


---

## 13. Tuitions — `/tuition`


| M      | Path                | Auth | Scenario               | Payload                                             | Response                                                                  | Roles    | Status      |
| ------ | ------------------- | ---- | ---------------------- | --------------------------------------------------- | ------------------------------------------------------------------------- | -------- | ----------- |
| POST   | `/tuition/create`   | JWT  | success                | `{ classId, studentId, amount, dueDate?, note? }`   | Created tuition                                                           | All      |             |
| POST   | `/tuition/create`   | JWT  | 400/404                | Body                                                | `"tutorId must be uuid"` • `"classId must be uuid"` • `"Class not found"` | All      |             |
| POST   | `/tuition/create`   | JWT  | 422: classId           | not uuid                                            | `"Invalid class ID"`                                                      | All      |             |
| POST   | `/tuition/create`   | JWT  | 422: studentId         | not uuid                                            | `"Invalid student ID"`                                                    | All      |             |
| POST   | `/tuition/create`   | JWT  | 422: amount            | missing • &lt; 0                                    | `"Amount is required"` • `"Amount must be positive"`                      | All      |             |
| POST   | `/tuition/create`   | JWT  | 422: status            | invalid enum                                        | `"Invalid enum value. Expected 'PAID'                                     | 'UNPAID' | 'OVERDUE'"` |
| GET    | `/tuition/getAll`   | JWT  | success                | Query: `page, limit, classId?, studentId?, status?` | Paginated tuitions                                                        | All      |             |
| GET    | `/tuition/getAll`   | JWT  | 422: page/limit        | out of range                                        | Same as users                                                             | All      |             |
| GET    | `/tuition/getAll`   | JWT  | 422: classId/studentId | not uuid                                            | Zod default                                                               | All      |             |
| GET    | `/tuition/getAll`   | JWT  | 422: status            | invalid enum                                        | `"Invalid enum value"`                                                    | All      |             |
| GET    | `/tuition/getSummary` | JWT  | success                | Query: `classId?`                                   | `{ totalPaid, totalUnpaid, totalOverdue, totalRevenue }`                  | All      |             |
| GET    | `/tuition/getSummary` | JWT  | 400                    | Query                                               | `"classId must be uuid"`                                                  | All      |             |
| GET    | `/tuition/getById/:id` | JWT  | success                | —                                                   | Tuition detail                                                            | All      |             |
| GET    | `/tuition/getById/:id` | JWT  | 400/404                | —                                                   | `"id must be uuid"` • `"Tuition record not found"`                        | All      |             |
| PUT    | `/tuition/update/:id` | JWT  | success                | `{ amount?, dueDate?, status?, note? }`             | Updated tuition                                                           | All      |             |
| PUT    | `/tuition/update/:id` | JWT  | 400/404                | Body                                                | `"id must be uuid"` • `"Tuition record not found"` • `"Class not found"`  | All      |             |
| PUT    | `/tuition/update/:id` | JWT  | 422: amount            | &lt; 0                                              | `"Amount must be positive"`                                               | All      |             |
| PUT    | `/tuition/update/:id` | JWT  | 422: status            | invalid enum                                        | `"Invalid enum value"`                                                    | All      |             |
| DELETE | `/tuition/delete/:id` | JWT  | success                | —                                                   | Deletion result                                                           | All      |             |
| DELETE | `/tuition/delete/:id` | JWT  | 400/404                | —                                                   | `"id must be uuid"` • `"Tuition record not found"`                        | All      |             |


---

## 14. Notifications — `/notifications`


| M      | Path                      | Auth | Scenario                      | Payload                                  | Response                                                                                    | Roles     | Status    |
| ------ | ------------------------- | ---- | ----------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- | --------- | --------- |
| POST   | `/notifications`          | JWT  | success                       | `{ title, content, type?, receiverId? }` | Created notification                                                                        | All       |           |
| POST   | `/notifications`          | JWT  | 400                           | Body                                     | `"UserId not valid"` • `"User not found"` • `"classId not valid"` • `"studentId not valid"` | All       |           |
| POST   | `/notifications`          | JWT  | 422: title                    | missing • &gt; 255                       | `"Title is required"` • `"Title too long"`                                                  | All       |           |
| POST   | `/notifications`          | JWT  | 422: type                     | invalid enum                             | `"Invalid enum value. Expected 'SYSTEM'                                                     | 'TUITION' | 'STUDENT' |
| POST   | `/notifications`          | JWT  | 422: content                  | missing                                  | `"Content must be string"`                                                                  | All       |           |
| POST   | `/notifications`          | JWT  | 422: userId/classId/studentId | not uuid                                 | `"userId must be uuid"` • `"classId must be uuid"` • `"studentId must be uuid"`             | All       |           |
| POST   | `/notifications`          | JWT  | 422: actionType               | invalid enum                             | `"Invalid enum value. Expected 'VIEW'                                                       | 'CONTACT' | 'PAYMENT' |
| POST   | `/notifications`          | JWT  | 422: redirectUrl              | &gt; 500 chars                           | Zod default                                                                                 | All       |           |
| POST   | `/notifications`          | JWT  | 422: subContent               | &gt; 255 chars                           | Zod default                                                                                 | All       |           |
| GET    | `/notifications`          | JWT  | success                       | Query: `type?, isRead?`                  | Notifications for current user                                                              | All       |           |
| GET    | `/notifications`          | JWT  | 422: type                     | invalid enum                             | `"Invalid enum value"`                                                                      | All       |           |
| GET    | `/notifications/:id`      | JWT  | success                       | —                                        | Notification detail                                                                         | All       |           |
| GET    | `/notifications/:id`      | JWT  | 404                           | —                                        | `"Notification not found"`                                                                  | All       |           |
| PATCH  | `/notifications/:id/read` | JWT  | success                       | —                                        | Marked as read                                                                              | All       |           |
| PATCH  | `/notifications/:id/read` | JWT  | 404                           | —                                        | `"Notification not found"`                                                                  | All       |           |
| PATCH  | `/notifications/read-all` | JWT  | success                       | —                                        | `{ markedAll: true }`                                                                       | All       |           |
| DELETE | `/notifications/:id`      | JWT  | success                       | —                                        | Deletion result                                                                             | All       |           |
| DELETE | `/notifications/:id`      | JWT  | 404                           | —                                        | `"Notification not found"`                                                                  | All       |           |


---

## 15. Dashboard — `/dashboard`


| M   | Path                  | Auth | Scenario | Payload | Response                                                                                                               | Roles | Status |
| --- | --------------------- | ---- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| GET | `/dashboard/overview` | JWT  | success  | —       | `{ role, stats: { classesCount, studentsCount, sessionsThisWeek, ... }, todaySchedule, monthly, recentNotifications }` | All   |        |
| GET | `/dashboard/overview` | JWT  | 400/404  | —       | `"User Id must be uuid"` • `"User not found"`                                                                          | All   |        |


---

## 16. Redis — `/redis`


| M   | Path     | Auth | Scenario | Payload      | Response                        | Roles | Status |
| --- | -------- | ---- | -------- | ------------ | ------------------------------- | ----- | ------ |
| GET | `/redis` | JWT  | success  | Query: `key` | `string                         | null` | All    |
| GET | `/redis` | JWT  | 400      | Query        | `"key query param is required"` | All   |        |


---

## 17. Upload (Cloudflare R2) — `/upload`


| M      | Path               | Auth   | Scenario | Payload                       | Response                                                   | Roles | Status |
| ------ | ------------------ | ------ | -------- | ----------------------------- | ---------------------------------------------------------- | ----- | ------ |
| POST   | `/upload`          | Public | success  | Multipart: `file`             | `{ url, key, size, mimetype }`                             | —     |        |
| POST   | `/upload/multiple` | Public | success  | Multipart: `files[]` (max 10) | `Array<{ url, key, size, mimetype }>`                      | —     |        |
| GET    | `/upload/download` | Public | success  | Query: `key`                  | File stream (Content-Type + Content-Disposition)           | —     |        |
| GET    | `/upload/download` | Public | 400/404  | Query                         | `"key query param is required"` • `"File {key} not found"` | —     |        |
| DELETE | `/upload/:key`     | Public | success  | —                             | Deletion confirmation                                      | —     |        |


---

## 19. AI Chat — `/ai-chat`


| M      | Path               | Auth | Scenario     | Payload                   | Response                                       | Roles | Status |
| ------ | ------------------ | ---- | ------------ | ------------------------- | ---------------------------------------------- | ----- | ------ |
| POST   | `/ai-chat/chat`    | JWT  | success      | `{ message }`             | `{ reply }` (history is DB-backed)             | All   |        |
| POST   | `/ai-chat/chat`    | JWT  | 422: message | missing • &gt; 4000 chars | `"Message is required"` • `"Message too long"` | All   |        |
| GET    | `/ai-chat/history` | JWT  | success      | Query: `limit?`           | `{ messages: [{ role, content }] }`            | All   |        |
| GET    | `/ai-chat/history` | JWT  | 422: limit   | &gt; 200 • not positive   | Zod default                                    | All   |        |
| DELETE | `/ai-chat/history` | JWT  | success      | —                         | `{ cleared: true }`                            | All   |        |


---

## 19. Reports (Learning) — `/report`


| M    | Path                                | Auth | Scenario  | Payload                      | Response                                                                 | Roles | Status |
| ---- | ----------------------------------- | ---- | --------- | ---------------------------- | ------------------------------------------------------------------------ | ----- | ------ |
| GET  | `/report/summary`                   | JWT  | success   | —                            | `{ activeClasses, avgAttendanceRate, avgCurriculumProgress, submissionRate }` | ADMIN |        |
| GET  | `/report/attendanceTrend`           | JWT  | success   | —                            | `[{ month, rate }]` (6 months)                                           | ADMIN |        |
| GET  | `/report/classList`                 | JWT  | success   | Query: `page, limit, search?`| `{ data: ClassReportRow[], pagination }`                                 | ADMIN |        |
| GET  | `/report/classList`                 | JWT  | 422       | Query invalid                | Same page/limit rules as users                                           | ADMIN |        |


---

## 20. Email — `/emails`


| M   | Path     | Auth   | Scenario | Payload | Response                  | Roles | Status |
| --- | -------- | ------ | -------- | ------- | ------------------------- | ----- | ------ |
| POST | `/emails/test`| ADMIN | success  | —       | Test email sent response  | ADMIN |        |


---

## 21. Attendance — `/attendance`


| M   | Path                            | Auth | Scenario    | Payload                                        | Response                                                                            | Roles | Status |
| --- | ------------------------------- | ---- | ----------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ | ----- | ------ |
| GET | `/attendance/getBySession/:sessionId` | JWT  | success    | —                                               | Class roster merged with each student's attendance (`AttendanceRecordDto[]`)         | All   |        |
| GET | `/attendance/getBySession/:sessionId` | JWT  | 404        | —                                               | `"Session not found"` (no access: not owner/enrolled/parent)                        | All   |        |
| PUT | `/attendance/upsert`               | JWT  | success    | `{ sessionId, studentId, present, note? }`      | Upserted attendance row (created or updated)                                        | All   |        |
| PUT | `/attendance/upsert`               | JWT  | 403        | Body                                            | `"Only the assigned tutor can mark attendance for this session"` (non-owner tutor)  | All   |        |
| PUT | `/attendance/upsert`               | JWT  | 404        | Body                                            | `"Session not found"` • `"Student not found"` (studentId not enrolled in the class) | All   |        |
| PUT | `/attendance/upsert`               | JWT  | 422        | `sessionId`/`studentId` not uuid, `present` not boolean, `note` &gt; 500 chars | Zod default                                        | All   |        |

Notes: one row per `(sessionId, studentId)` (DB unique index `attendances_session_student_unique`,
upserted via `onConflictDoUpdate`). Only the class's tutor (owner of the session's class) may write;
read access follows the same rule as `GET /sessions/:id` (owner, enrolled student, or their parent).


---

## Summary


| #         | Controller             | Base Path          | Routes  | Public | Role-restricted |
| --------- | ---------------------- | ------------------ | ------- | ------ | --------------- |
| 1         | AppController          | `/`                | 1       | 0      | 0               |
| 2         | AuthController         | `/auth`            | 10      | 9      | 0               |
| 3         | UserController         | `/users`           | 13      | 0      | 3 (ADMIN,TUTOR) |
| 4         | AdminController        | `/admin`           | 10      | 0      | 10 (ADMIN)      |
| 5         | ClassController        | `/class`           | 9       | 0      | 0               |
| 6         | StudentController      | `/students`        | 6       | 0      | 0               |
| 7         | SessionController      | `/session`         | 7       | 0      | 0               |
| 8         | ScheduleController     | `/schedule`        | 7       | 0      | 0               |
| 9         | CurriculumController   | `/curriculum`      | 6       | 0      | 0               |
| 10        | ChapterController      | `/chapter`         | 5       | 0      | 0               |
| 11        | LessonController       | `/lesson` | 9    | 0      | 0               |
| 12        | ExerciseController     | `/exercise`        | 5       | 0      | 0               |
| 13        | TuitionController      | `/tuition`         | 6       | 0      | 0               |
| 14        | NotificationController | `/notifications`   | 6       | 0      | 0               |
| 15        | DashboardController    | `/dashboard`       | 1       | 0      | 0               |
| 16        | RedisController        | `/redis`           | 1       | 0      | 0               |
| 17        | UploadController       | `/upload`          | 4       | 4      | 0               |
| 18        | AiController           | `/ai-chat`         | 3       | 0      | 0               |
| 19        | ReportController       | `/report`          | 3       | 0      | 3 (ADMIN)       |
| 20        | EmailController        | `/emails`          | 1       | 1      | 0               |
| 21        | AttendanceController   | `/attendance`      | 2       | 0      | 0               |
| **Total** |                        |                    | **115** | **14** | **16**          |


---

## Known bugs found during audit


| Bug                                             | File                                | Detail                                                                                              |
| ----------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| lastName field shows "First name" in error msgs | `user.schema.ts`, `admin.schema.ts` | `lastName` min/max messages say `"First name must be at least 2 characters"` instead of "Last name" |
| subjects field uses "Province" label            | `user.schema.ts`                    | `subjects.max(30)` message says `"Province must be at most 30 characters"`                          |
| gradesId validation shows "Class Id" label      | `user.schema.ts`                    | `gradesId` validation message says `"Class Id must be uuid"` instead of "Grades Id"                 |
| `GET /curriculum` uses wallet schema            | `curriculum.controller.ts:89`       | Uses `getWalletsQuerySchema` instead of `getCurriculumsQuerySchema`                                 |
| `POST /curriculum` has no Zod validation        | `curriculum.controller.ts`          | No `ZodValidationPipe` applied to `@Body()`                                                         |
| `PUT /curriculum/:id` has no Zod validation     | `curriculum.controller.ts`          | No `ZodValidationPipe` applied to `@Body()`                                                         |


