/**
 * Narrow contract for signing — `JwtService` from `@nestjs/jwt` satisfies this structurally
 * and avoids type-resolution noise from recommended-type-checked ESLint in some setups.
 */
export type JwtSignContract = {
  signAsync: (payload: object, options: { secret: string; expiresIn: number }) => Promise<string>;
};

/**
 * TTL mặc định (giây). Ghi đè bằng env:
 * - `JWT_ACCESS_EXPIRES_SECONDS` (mặc định 3 giờ)
 * - `JWT_REFRESH_EXPIRES_SECONDS` (mặc định 7 ngày)
 *
 * Secret: dùng UUID (v4) trong `.env` cho `JWT_ACCESS_SECRET` và `JWT_REFRESH_SECRET`
 * (xem `.env.example`).
 */
export const DEFAULT_JWT_ACCESS_EXPIRES_SECONDS = 60 * 60 * 3; // 3h
export const DEFAULT_JWT_REFRESH_EXPIRES_SECONDS = 60 * 60 * 24 * 7; // 7d

export type JwtTokenTyp = 'access' | 'refresh';

/** Matches DB `user_role` enum — embedded on access JWTs for route guards. */
export type JwtUserRole = 'STUDENT' | 'ADMIN' | 'TUTOR' | 'PARENT';

export type JwtAccessPayload = {
  sub: string;
  email: string;
  typ: 'access';
  role: JwtUserRole;
  /** login session id; the session must still exist in redis (CONTRACT C1) */
  sid: string;
};

export type JwtRefreshPayload = {
  sub: string;
  email: string;
  typ: 'refresh';
};

export type JwtPayload = JwtAccessPayload | JwtRefreshPayload;

/** Secrets + TTLs for access and refresh JWTs */
export type JwtTokensConfig = {
  accessSecret: string;
  accessExpiresIn: number;
  refreshSecret: string;
  refreshExpiresIn: number;
};

export async function signAccessToken(
  jwtService: JwtSignContract,
  payload: Pick<JwtAccessPayload, 'sub' | 'email' | 'role' | 'sid'>,
  config: JwtTokensConfig,
): Promise<string> {
  const body: JwtAccessPayload = { ...payload, typ: 'access' };
  return jwtService.signAsync(body, {
    secret: config.accessSecret,
    expiresIn: config.accessExpiresIn,
  });
}

export async function signRefreshToken(
  jwtService: JwtSignContract,
  payload: Pick<JwtRefreshPayload, 'sub' | 'email'>,
  config: JwtTokensConfig,
): Promise<string> {
  const body: JwtRefreshPayload = { ...payload, typ: 'refresh' };
  return jwtService.signAsync(body, {
    secret: config.refreshSecret,
    expiresIn: config.refreshExpiresIn,
  });
}
