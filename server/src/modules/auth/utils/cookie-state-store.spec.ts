import { CookieStateStore } from './cookie-state-store';
import { OAuthProvider } from '../enums/oauth-provider.enum';
import type { Request, Response } from 'express';

/**
 * The jar is shared between requests on purpose: a browser replays every
 * cookie it holds, which is what makes concurrent flows collide.
 */
function mockReqRes(cookies: Record<string, string> = {}) {
  const cookieFn = jest.fn((name: string, value: string) => {
    cookies[name] = value;
    return res;
  });
  const clearCookieFn = jest.fn((name: string) => {
    delete cookies[name];
    return res;
  });

  // @ts-expect-error testing mock
  const res: Response = {
    cookie: cookieFn,
    clearCookie: clearCookieFn
  };

  // @ts-expect-error testing mock
  const req: Request & { res: Response } = { cookies, res };

  return { req, res, cookies, cookieFn, clearCookieFn };
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** Builds the cookie value the store writes: `<state>-<expiresAt>` entries. */
function pendingCookie(...states: string[]): string {
  const expiresAt = Date.now() + FIVE_MINUTES_MS;
  return states.map((state) => `${state}-${expiresAt}`).join('.');
}

function storeSync(store: CookieStateStore, req: Request): string {
  let captured: string | undefined;
  store.store(req, (err, state) => {
    expect(err).toBeNull();
    captured = state as string;
  });
  return captured!;
}

function verifySync(
  store: CookieStateStore,
  req: Request,
  providedState: string
): boolean {
  let captured: boolean | undefined;
  store.verify(req, providedState, (err, ok) => {
    expect(err).toBeNull();
    captured = ok;
  });
  return captured!;
}

describe('CookieStateStore', () => {
  // passport-oauth2 dispatches on `store.length` / `verify.length`
  // (strategy.js), so an extra or missing parameter silently changes which
  // overload it calls.
  describe('passport arity contract', () => {
    it('should keep the arities passport dispatches on', () => {
      const store = new CookieStateStore(OAuthProvider.GOOGLE, false);

      expect(store.store.length).toBe(3);
      expect(store.verify.length).toBe(4);
    });
  });

  describe('store', () => {
    it('should generate a random state and set it as a provider-scoped cookie', (done) => {
      const store = new CookieStateStore(OAuthProvider.GOOGLE, false);
      const { req, cookieFn } = mockReqRes();

      store.store(req, (err, state) => {
        expect(err).toBeNull();
        expect(state).toBeDefined();
        expect(typeof state).toBe('string');
        expect(String(state).length).toBe(64); // 32 bytes = 64 hex chars
        expect(cookieFn).toHaveBeenCalledWith(
          'oauth_state_google',
          expect.stringMatching(new RegExp(`^${String(state)}-\\d+$`)),
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
      const store = new CookieStateStore(OAuthProvider.GOOGLE, true);
      const { req, cookieFn } = mockReqRes();

      store.store(req, () => {
        expect(cookieFn).toHaveBeenCalledWith(
          'oauth_state_google',
          expect.any(String),
          expect.objectContaining({ secure: true })
        );
        done();
      });
    });

    it('should generate unique state values', (done) => {
      const store = new CookieStateStore(OAuthProvider.GOOGLE, false);
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

    it('should fail instead of returning an unpersisted state when the request has no response', (done) => {
      const store = new CookieStateStore(OAuthProvider.GOOGLE, false);
      // @ts-expect-error testing mock
      const req: Request = { cookies: {} };

      store.store(req, (err, state) => {
        expect(err).toBeInstanceOf(Error);
        expect(state).toBeUndefined();
        done();
      });
    });
  });

  describe('verify', () => {
    it('should return true when cookie matches provided state', (done) => {
      const store = new CookieStateStore(OAuthProvider.GOOGLE, false);
      const { req, clearCookieFn } = mockReqRes({
        oauth_state_google: pendingCookie('abc123')
      });

      store.verify(req, 'abc123', (err, ok) => {
        expect(err).toBeNull();
        expect(ok).toBe(true);
        expect(clearCookieFn).toHaveBeenCalledWith('oauth_state_google', {
          path: '/api/v1/auth/oauth'
        });
        done();
      });
    });

    it('should return false when cookie does not match', (done) => {
      const store = new CookieStateStore(OAuthProvider.GOOGLE, false);
      const { req } = mockReqRes({
        oauth_state_google: pendingCookie('abc123')
      });

      store.verify(req, 'wrong-state', (err, ok) => {
        expect(err).toBeNull();
        expect(ok).toBe(false);
        done();
      });
    });

    // The comparison is constant-time, so it must not throw on a length
    // mismatch (timingSafeEqual rejects unequal buffers) nor short-circuit
    it('should return false for a same-length near-match', (done) => {
      const store = new CookieStateStore(OAuthProvider.GOOGLE, false);
      const { req } = mockReqRes({
        oauth_state_google: pendingCookie('abc123')
      });

      store.verify(req, 'abc124', (err, ok) => {
        expect(err).toBeNull();
        expect(ok).toBe(false);
        done();
      });
    });

    it('should return false for a differing-length state without throwing', (done) => {
      const store = new CookieStateStore(OAuthProvider.GOOGLE, false);
      const { req } = mockReqRes({
        oauth_state_google: pendingCookie('abc123')
      });

      store.verify(req, 'abc123-much-longer', (err, ok) => {
        expect(err).toBeNull();
        expect(ok).toBe(false);
        done();
      });
    });

    it('should return false when cookie is missing', (done) => {
      const store = new CookieStateStore(OAuthProvider.GOOGLE, false);
      const { req } = mockReqRes({});

      store.verify(req, 'some-state', (err, ok) => {
        expect(err).toBeNull();
        expect(ok).toBe(false);
        done();
      });
    });

    it('should return false when the callback carries no state', (done) => {
      const store = new CookieStateStore(OAuthProvider.GOOGLE, false);
      const { req } = mockReqRes({
        oauth_state_google: pendingCookie('abc123')
      });

      // @ts-expect-error passport passes through whatever the query held
      store.verify(req, undefined, (err, ok) => {
        expect(err).toBeNull();
        expect(ok).toBe(false);
        done();
      });
    });

    it('should clear the cookie after verification', (done) => {
      const store = new CookieStateStore(OAuthProvider.GOOGLE, false);
      const { req, clearCookieFn } = mockReqRes({
        oauth_state_google: pendingCookie('stateval')
      });

      store.verify(req, 'stateval', () => {
        expect(clearCookieFn).toHaveBeenCalledWith('oauth_state_google', {
          path: '/api/v1/auth/oauth'
        });
        done();
      });
    });

    it('should not consume a pending state when verification fails', () => {
      const store = new CookieStateStore(OAuthProvider.GOOGLE, false);
      const jar: Record<string, string> = {};
      const state = storeSync(store, mockReqRes(jar).req);

      expect(verifySync(store, mockReqRes(jar).req, 'not-the-state')).toBe(
        false
      );
      expect(verifySync(store, mockReqRes(jar).req, state)).toBe(true);
    });
  });

  describe('concurrent flows', () => {
    it('should keep each provider on its own cookie', () => {
      const jar: Record<string, string> = {};
      const google = new CookieStateStore(OAuthProvider.GOOGLE, false);
      const vk = new CookieStateStore(OAuthProvider.VK, false);

      const googleState = storeSync(google, mockReqRes(jar).req);
      const vkState = storeSync(vk, mockReqRes(jar).req);

      expect(jar['oauth_state_google']).toContain(googleState);
      expect(jar['oauth_state_vk']).toContain(vkState);

      expect(verifySync(google, mockReqRes(jar).req, googleState)).toBe(true);
      expect(verifySync(vk, mockReqRes(jar).req, vkState)).toBe(true);
    });

    it('should not let one provider verify another provider state', () => {
      const jar: Record<string, string> = {};
      const google = new CookieStateStore(OAuthProvider.GOOGLE, false);
      const vk = new CookieStateStore(OAuthProvider.VK, false);

      const googleState = storeSync(google, mockReqRes(jar).req);
      storeSync(vk, mockReqRes(jar).req);

      expect(verifySync(vk, mockReqRes(jar).req, googleState)).toBe(false);
    });

    it('should let two tabs of the same provider finish independently', () => {
      const jar: Record<string, string> = {};
      const store = new CookieStateStore(OAuthProvider.GOOGLE, false);

      const firstTab = storeSync(store, mockReqRes(jar).req);
      const secondTab = storeSync(store, mockReqRes(jar).req);

      expect(verifySync(store, mockReqRes(jar).req, secondTab)).toBe(true);
      expect(verifySync(store, mockReqRes(jar).req, firstTab)).toBe(true);
      expect(jar['oauth_state_google']).toBeUndefined();
    });

    it('should not accept a state twice', () => {
      const jar: Record<string, string> = {};
      const store = new CookieStateStore(OAuthProvider.GOOGLE, false);

      const state = storeSync(store, mockReqRes(jar).req);

      expect(verifySync(store, mockReqRes(jar).req, state)).toBe(true);
      expect(verifySync(store, mockReqRes(jar).req, state)).toBe(false);
    });

    it('should not let a later flow extend an earlier state deadline', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-07-30T12:00:00Z'));

      const jar: Record<string, string> = {};
      const store = new CookieStateStore(OAuthProvider.GOOGLE, false);

      const firstTab = storeSync(store, mockReqRes(jar).req);

      // Refreshes the cookie's own maxAge four minutes in.
      jest.setSystemTime(new Date('2026-07-30T12:04:00Z'));
      const secondTab = storeSync(store, mockReqRes(jar).req);

      jest.setSystemTime(new Date('2026-07-30T12:06:00Z'));

      expect(verifySync(store, mockReqRes(jar).req, firstTab)).toBe(false);
      expect(verifySync(store, mockReqRes(jar).req, secondTab)).toBe(true);

      jest.useRealTimers();
    });

    it('should evict the oldest pending state beyond the cap', () => {
      const jar: Record<string, string> = {};
      const store = new CookieStateStore(OAuthProvider.GOOGLE, false);

      const states = Array.from({ length: 6 }, () =>
        storeSync(store, mockReqRes(jar).req)
      );

      expect(verifySync(store, mockReqRes(jar).req, states[0])).toBe(false);
      expect(verifySync(store, mockReqRes(jar).req, states[5])).toBe(true);
    });
  });
});
