import { CookieStateStore } from './cookie-state-store';
import type { Request, Response } from 'express';

function mockReqRes(cookies: Record<string, string> = {}) {
  const cookieFn = jest.fn();
  const clearCookieFn = jest.fn();

  const res = {
    cookie: cookieFn,
    clearCookie: clearCookieFn
  } as unknown as Response;

  const req = { cookies, res } as unknown as Request & { res: Response };

  return { req, cookieFn, clearCookieFn };
}

describe('CookieStateStore', () => {
  describe('store', () => {
    it('should generate a random state and set it as a cookie', (done) => {
      const store = new CookieStateStore(false);
      const { req, cookieFn } = mockReqRes();

      store.store(req, (err, state) => {
        expect(err).toBeNull();
        expect(state).toBeDefined();
        expect(typeof state).toBe('string');
        expect(String(state).length).toBe(64); // 32 bytes = 64 hex chars
        expect(cookieFn).toHaveBeenCalledWith(
          'oauth_state',
          state,
          expect.objectContaining({
            httpOnly: true,
            sameSite: 'lax',
            secure: false,
            path: '/api/v1/auth/oauth'
          })
        );
        done();
      });
    });

    it('should set secure cookie in production', (done) => {
      const store = new CookieStateStore(true);
      const { req, cookieFn } = mockReqRes();

      store.store(req, () => {
        expect(cookieFn).toHaveBeenCalledWith(
          'oauth_state',
          expect.any(String),
          expect.objectContaining({ secure: true })
        );
        done();
      });
    });

    it('should generate unique state values', (done) => {
      const store = new CookieStateStore(false);
      const states: string[] = [];

      const collectState = (err: Error | null, state?: string) => {
        expect(err).toBeNull();
        states.push(state!);
        if (states.length === 2) {
          expect(states[0]).not.toBe(states[1]);
          done();
        }
      };

      store.store(mockReqRes().req, collectState);
      store.store(mockReqRes().req, collectState);
    });
  });

  describe('verify', () => {
    it('should return true when cookie matches provided state', (done) => {
      const store = new CookieStateStore(false);
      const { req, clearCookieFn } = mockReqRes({ oauth_state: 'abc123' });

      store.verify(req, 'abc123', (err, ok) => {
        expect(err).toBeNull();
        expect(ok).toBe(true);
        expect(clearCookieFn).toHaveBeenCalledWith('oauth_state', {
          path: '/api/v1/auth/oauth'
        });
        done();
      });
    });

    it('should return false when cookie does not match', (done) => {
      const store = new CookieStateStore(false);
      const { req } = mockReqRes({ oauth_state: 'abc123' });

      store.verify(req, 'wrong-state', (err, ok) => {
        expect(err).toBeNull();
        expect(ok).toBe(false);
        done();
      });
    });

    it('should return false when cookie is missing', (done) => {
      const store = new CookieStateStore(false);
      const { req } = mockReqRes({});

      store.verify(req, 'some-state', (err, ok) => {
        expect(err).toBeNull();
        expect(ok).toBe(false);
        done();
      });
    });

    it('should clear the cookie after verification', (done) => {
      const store = new CookieStateStore(false);
      const { req, clearCookieFn } = mockReqRes({ oauth_state: 'state-val' });

      store.verify(req, 'state-val', () => {
        expect(clearCookieFn).toHaveBeenCalledWith('oauth_state', {
          path: '/api/v1/auth/oauth'
        });
        done();
      });
    });
  });
});
