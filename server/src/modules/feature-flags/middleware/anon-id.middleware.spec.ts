import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ANON_ID_COOKIE, AnonIdMiddleware } from './anon-id.middleware';

interface MockRes {
  cookie: jest.Mock;
}

describe('AnonIdMiddleware', () => {
  let middleware: AnonIdMiddleware;
  let configService: { get: jest.Mock };

  beforeEach(() => {
    configService = { get: jest.fn().mockReturnValue('development') };
    middleware = new AnonIdMiddleware(
      configService as unknown as ConfigService
    );
  });

  it('issues a new cookie when none is present', () => {
    const req = { cookies: {} } as unknown as Request;
    const res = { cookie: jest.fn() } as unknown as Response & MockRes;
    const next = jest.fn();
    middleware.use(req, res, next);
    expect((res as unknown as MockRes).cookie).toHaveBeenCalledWith(
      ANON_ID_COOKIE,
      expect.stringMatching(/^[0-9a-f-]{36}$/i),
      expect.objectContaining({
        sameSite: 'lax',
        httpOnly: false,
        path: '/'
      })
    );
    expect(req.cookies[ANON_ID_COOKIE]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(next).toHaveBeenCalled();
  });

  it('leaves an existing cookie untouched', () => {
    const existing = 'existing-uuid-value';
    const req = {
      cookies: { [ANON_ID_COOKIE]: existing }
    } as unknown as Request;
    const res = { cookie: jest.fn() } as unknown as Response & MockRes;
    const next = jest.fn();
    middleware.use(req, res, next);
    expect((res as unknown as MockRes).cookie).not.toHaveBeenCalled();
    expect(req.cookies[ANON_ID_COOKIE]).toBe(existing);
    expect(next).toHaveBeenCalled();
  });

  it('sets Secure flag in production', () => {
    configService.get.mockReturnValue('production');
    const req = { cookies: {} } as unknown as Request;
    const cookieSpy = jest.fn();
    const res = { cookie: cookieSpy } as unknown as Response & MockRes;
    middleware.use(req, res, jest.fn());
    const calls = cookieSpy.mock.calls as Array<
      [string, string, { secure?: boolean }]
    >;
    expect(calls[0][2]).toMatchObject({ secure: true });
  });
});
