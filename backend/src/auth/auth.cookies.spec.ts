import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';

describe('auth cookie configuration', () => {
  const previous = process.env.NODE_ENV;
  const auth = { login: jest.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', user: {} }), logout: jest.fn().mockResolvedValue(undefined) };
  const controller = new AuthController(auth as unknown as AuthService);
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  const response = { cookie, clearCookie };

  afterEach(() => { process.env.NODE_ENV = previous; jest.clearAllMocks(); });

  it.each([['development', false], ['production', true]] as const)('sets matching login and logout cookie flags in %s', async (mode, secure) => {
    process.env.NODE_ENV = mode;
    await controller.login({ email: 'user@example.test', password: 'password' }, response as never);
    expect(cookie).toHaveBeenCalledTimes(2);
    for (const call of cookie.mock.calls) expect(call[2]).toEqual(expect.objectContaining({ secure, httpOnly: true, sameSite: 'lax', path: '/' }));
    await controller.logout({ cookies: { access_token: '' } } as never, response as never);
    for (const call of clearCookie.mock.calls) expect(call[1]).toEqual(expect.objectContaining({ secure, httpOnly: true, sameSite: 'lax', path: '/' }));
  });
});
