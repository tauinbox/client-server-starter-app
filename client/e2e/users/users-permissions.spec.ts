import {
  expect,
  expectNoSnackbar,
  loginViaUi,
  test
} from '../fixtures/base.fixture';
import { mockId } from '../fixtures/ids';

test.describe('User effective permissions page', () => {
  test('an administrator sign-in loads no RBAC catalog; the page loads it', async ({
    _mockServer,
    page
  }) => {
    const rbacRequests: string[] = [];
    page.on('request', (req) => {
      const { pathname } = new URL(req.url());
      if (pathname.startsWith('/api/v1/rbac/')) rbacRequests.push(pathname);
    });

    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    expect(rbacRequests).toEqual([]);

    const catalog = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/rbac/resources'
    );
    // A regular user: a super role shows no resource groups.
    await page.goto(`/admin/users/${mockId('user-2')}/permissions`);
    expect((await catalog).status()).toBe(200);

    // The display name comes from the catalog; the resource name is `profile`.
    await expect(
      page.locator('.resource-title', { hasText: /^Profile$/ })
    ).toBeVisible();
    expect(rbacRequests).toEqual(['/api/v1/rbac/resources']);
  });

  test('reports a failed load in the card only', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.route(
      `**/api/v1/users/${mockId('user-2')}/permissions`,
      (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Internal error', statusCode: 500 })
        })
    );
    await page.goto(`/admin/users/${mockId('user-2')}/permissions`);

    await expect(
      page.getByText('Failed to load effective permissions. Please try again.')
    ).toBeVisible();
    await expectNoSnackbar(page);
  });
});
