import { ConfigService } from '@nestjs/config';
import { ANON_ID_COOKIE, AnonIdMiddleware } from './anon-id.middleware';
import {
  createMockRequest,
  createMockResponse
} from '../../../common/testing/express.mock';

const HOST_ANON_ID_COOKIE = `__Host-${ANON_ID_COOKIE}`;

describe('AnonIdMiddleware', () => {
  let middleware: AnonIdMiddleware;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;

  beforeEach(() => {
    configService = { get: jest.fn().mockReturnValue('development') };
    // @ts-expect-error - partial mock: middleware only reads ConfigService.get
    middleware = new AnonIdMiddleware(configService);
  });

  it('issues a new cookie when none is present', () => {
    const req = createMockRequest({ cookies: {} });
    const res = createMockResponse({ cookie: jest.fn() });
    const next = jest.fn();
    middleware.use(req, res, next);
    expect(res.cookie).toHaveBeenCalledWith(
      HOST_ANON_ID_COOKIE,
      expect.stringMatching(/^[0-9a-f-]{36}$/i),
      expect.objectContaining({
        sameSite: 'lax',
        // Bucketing is server-side; no browser script reads this cookie
        httpOnly: true,
        secure: true,
        path: '/'
      })
    );
    expect(req.cookies[HOST_ANON_ID_COOKIE]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(next).toHaveBeenCalled();
  });

  it('leaves an existing cookie untouched', () => {
    const existing = 'existing-uuid-value';
    const req = createMockRequest({
      cookies: { [HOST_ANON_ID_COOKIE]: existing }
    });
    const res = createMockResponse({ cookie: jest.fn() });
    const next = jest.fn();
    middleware.use(req, res, next);
    expect(res.cookie).not.toHaveBeenCalled();
    expect(req.cookies[HOST_ANON_ID_COOKIE]).toBe(existing);
    expect(next).toHaveBeenCalled();
  });

  it('carries a bare cookie from before the prefix over to the prefixed name', () => {
    const req = createMockRequest({
      cookies: { [ANON_ID_COOKIE]: 'returning-visitor' }
    });
    const res = createMockResponse({
      cookie: jest.fn(),
      clearCookie: jest.fn()
    });
    middleware.use(req, res, jest.fn());
    expect(res.cookie).toHaveBeenCalledWith(
      HOST_ANON_ID_COOKIE,
      'returning-visitor',
      expect.objectContaining({ secure: true, path: '/' })
    );
    expect(res.clearCookie).toHaveBeenCalledWith(ANON_ID_COOKIE, {
      secure: true,
      path: '/'
    });
    expect(req.cookies[HOST_ANON_ID_COOKIE]).toBe('returning-visitor');
  });

  it('issues the bare name in local and never clears it', () => {
    configService.get.mockReturnValue('local');
    const req = createMockRequest({ cookies: {} });
    const res = createMockResponse({
      cookie: jest.fn(),
      clearCookie: jest.fn()
    });
    middleware.use(req, res, jest.fn());
    expect(res.cookie).toHaveBeenCalledWith(
      ANON_ID_COOKIE,
      expect.any(String),
      expect.objectContaining({ secure: false, path: '/' })
    );
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  function secureFlagFor(environment: string): boolean | undefined {
    configService.get.mockReturnValue(environment);
    const req = createMockRequest({ cookies: {} });
    const cookieSpy = jest.fn();
    const res = createMockResponse({ cookie: cookieSpy });
    middleware.use(req, res, jest.fn());
    const calls = cookieSpy.mock.calls as Array<
      [string, string, { secure?: boolean }]
    >;
    return calls[0][2].secure;
  }

  it('sets Secure flag in production', () => {
    expect(secureFlagFor('production')).toBe(true);
  });

  // Regression: the flag came from an === 'production' comparison, so the two
  // middle environments issued the cookie over plain HTTP.
  it('sets Secure flag in development and staging too', () => {
    expect(secureFlagFor('development')).toBe(true);
    expect(secureFlagFor('staging')).toBe(true);
  });

  it('leaves Secure off in local, which the dev proxy serves over HTTP', () => {
    expect(secureFlagFor('local')).toBe(false);
  });
});
