import { expect, loginViaUi, test } from '../fixtures/base.fixture';

// Browser-level regression for OAuth 2.0 BCP refresh-token reuse detection
// (BKL-009). The server-side service test in
// server/test/refresh-token-reuse.e2e-spec.ts pins the AuthService logic; this
// spec pins the cookie-jar-and-rotation contract end-to-end through the
// browser, where the bug would actually surface for an attacker who replayed
// a captured refresh token.
//
// Given a logged-in user holds refresh-token A (issued at login),
// when the legitimate client rotates A → B (first /refresh-token call),
// then presenting A a second time must:
//   1. Return 401 — the rotation alone makes A invalid, but reuse detection
//      ALSO panic-revokes all of the user's active refresh tokens.
//   2. Make B (the freshly-rotated token) unusable too — proving the
//      panic-revoke was system-wide, not just per-token.
test.describe('Refresh-token reuse detection (BKL-009)', () => {
  test('presenting a rotated refresh token a second time revokes ALL sessions', async ({
    _mockServer,
    page,
    context
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['user'] });

    // Capture the original refresh-token cookie issued at login. The browser
    // exposes HttpOnly cookies via the Playwright BrowserContext API even
    // though page-side JS cannot read them.
    const cookiesAfterLogin = await context.cookies();
    const original = cookiesAfterLogin.find((c) => c.name === 'refresh_token');
    expect(
      original,
      'refresh_token cookie should be set on login'
    ).toBeDefined();

    // First refresh — runs through the page so that base.fixture's page.route
    // can rewrite the URL to the worker's mock-server port. The server
    // rotates: old token moves to revokedRefreshTokens, new pair is issued.
    const firstStatus = await page.evaluate(() =>
      fetch('/api/v1/auth/refresh-token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }).then((r) => r.status)
    );
    expect(firstStatus).toBe(200);

    // Capture the newly-rotated cookie (B) before we restore the old one (A).
    const afterFirstRefresh = await context.cookies();
    const rotated = afterFirstRefresh.find((c) => c.name === 'refresh_token');
    expect(rotated?.value).not.toBe(original!.value);

    // Replace the rotated cookie with the original one to simulate replay of
    // a captured refresh token. addCookies overwrites HttpOnly cookies just
    // like the regular Set-Cookie path.
    await context.clearCookies({ name: 'refresh_token' });
    await context.addCookies([
      {
        name: 'refresh_token',
        value: original!.value,
        domain: original!.domain,
        path: original!.path,
        httpOnly: true,
        secure: original!.secure,
        sameSite: original!.sameSite
      }
    ]);

    // Second refresh with the SAME (now-revoked) token. Reuse detection trips:
    // server panic-revokes ALL refresh tokens for the user and returns 401.
    const secondStatus = await page.evaluate(() =>
      fetch('/api/v1/auth/refresh-token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }).then((r) => r.status)
    );
    expect(secondStatus).toBe(401);

    // The legitimate client's freshly-rotated token (B) must also be dead now.
    // This is what makes "reuse detection" meaningful: the attacker's replay
    // doesn't just lock themselves out, it proactively boots the real user
    // too — they will have to re-authenticate.
    await context.clearCookies({ name: 'refresh_token' });
    await context.addCookies([
      {
        name: 'refresh_token',
        value: rotated!.value,
        domain: rotated!.domain,
        path: rotated!.path,
        httpOnly: true,
        secure: rotated!.secure,
        sameSite: rotated!.sameSite
      }
    ]);
    const thirdStatus = await page.evaluate(() =>
      fetch('/api/v1/auth/refresh-token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }).then((r) => r.status)
    );
    expect(thirdStatus).toBe(401);
  });
});
