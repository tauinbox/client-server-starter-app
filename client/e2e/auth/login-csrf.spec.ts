import { expect, test } from '../fixtures/base.fixture';
import { loginViaUi } from '../fixtures/helpers';

// The attacker page must be a second page: a navigation through the fixture's
// `/api` rewrite stores no Set-Cookie, so it would pass a vulnerable backend.
test.describe('Login CSRF through a cross-site form', () => {
  test('keeps the victim signed in to their own account', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url);
    await expect(page.getByText('testlogin@example.com').first()).toBeVisible();

    const refreshCookie = async () =>
      (await page.context().cookies()).find((c) => c.name === 'refresh_token')
        ?.value;
    const before = await refreshCookie();

    const attacker = await page.context().newPage();
    await attacker.route('http://attacker.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<form method="POST" action="${_mockServer.url}/api/v1/auth/login">
<input name="email" value="user@example.com">
<input name="password" value="Password1"></form>
<script>document.forms[0].submit()</script>`
      })
    );
    const loginResponse = attacker.waitForResponse(/\/api\/v1\/auth\/login/);
    await attacker.goto('http://attacker.test/');
    expect((await loginResponse).status()).toBe(401);
    await attacker.close();

    expect(await refreshCookie()).toBe(before);

    await page.goto('/profile');
    await expect(page.getByText('testlogin@example.com').first()).toBeVisible();
    await expect(page.getByText('user@example.com')).toHaveCount(0);
  });
});
