import { JwtTokensConfig, signAccessToken, signRefreshToken } from '@packages/helpers/jwt.helper';

const config: JwtTokensConfig = {
  accessSecret: 'access-secret',
  accessExpiresIn: 900,
  refreshSecret: 'refresh-secret',
  refreshExpiresIn: 604800,
};

const jwtService = () => ({ signAsync: jest.fn().mockResolvedValue('signed.token') });

describe('signAccessToken', () => {
  it('signs with the access secret and TTL and tags the payload as an access token', async () => {
    const svc = jwtService();

    const token = await signAccessToken(
      svc as never,
      { sub: 'u1', email: 'a@b.dev', role: 'TUTOR' } as never,
      config,
    );

    expect(token).toBe('signed.token');
    expect(svc.signAsync).toHaveBeenCalledWith(
      { sub: 'u1', email: 'a@b.dev', role: 'TUTOR', typ: 'access' },
      { secret: 'access-secret', expiresIn: 900 },
    );
  });

  it('does not leak the refresh secret into access signing', async () => {
    const svc = jwtService();

    await signAccessToken(
      svc as never,
      { sub: 'u1', email: 'a', role: 'STUDENT' } as never,
      config,
    );

    expect(svc.signAsync.mock.calls[0][1]).not.toHaveProperty('secret', 'refresh-secret');
  });

  it('propagates a signing failure', async () => {
    const svc = { signAsync: jest.fn().mockRejectedValue(new Error('sign failed')) };

    await expect(
      signAccessToken(svc as never, { sub: 'u1', email: 'a', role: 'STUDENT' } as never, config),
    ).rejects.toThrow('sign failed');
  });
});

describe('signRefreshToken', () => {
  it('signs with the refresh secret and TTL and tags the payload as a refresh token', async () => {
    const svc = jwtService();

    const token = await signRefreshToken(
      svc as never,
      { sub: 'u1', email: 'a@b.dev' } as never,
      config,
    );

    expect(token).toBe('signed.token');
    expect(svc.signAsync).toHaveBeenCalledWith(
      { sub: 'u1', email: 'a@b.dev', typ: 'refresh' },
      { secret: 'refresh-secret', expiresIn: 604800 },
    );
  });
});
