import { expect, loginViaUiKeepSse, test } from '../fixtures/base.fixture';
import { mockId } from '../fixtures/ids';

// The role keeps its permission row: only the resource stops offering the
// action, so no role change event reaches the holder.
test.describe('Live RBAC update via SSE - resource narrowing', () => {
  test('admin link disappears when the resource stops offering the gating action', async ({
    _mockServer,
    page
  }) => {
    await page.unroute(/\/api\/.*\/notifications\/stream/);

    await _mockServer.seedPermissions([
      {
        id: 'perm-test-read-role',
        resourceId: mockId('res-roles'),
        actionId: mockId('act-read'),
        description: 'Read Role',
        createdAt: '2025-01-01T00:00:00.000Z'
      }
    ]);
    await _mockServer.changeRolePermissions('auditor', ['perm-test-read-role']);

    await loginViaUiKeepSse(page, _mockServer.url, {
      id: '100',
      roles: ['auditor']
    });
    await page.goto('/profile');

    const adminLink = page.getByRole('link', { name: 'Admin panel' });
    await expect(adminLink).toBeVisible();

    const login = await fetch(`${_mockServer.url}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'Password1'
      })
    });
    const { tokens } = (await login.json()) as {
      tokens: { access_token: string };
    };
    const narrowing = await fetch(
      `${_mockServer.url}/api/v1/rbac/resources/${mockId('res-roles')}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ allowedActionNames: ['create', 'update'] })
      }
    );
    expect(narrowing.status).toBe(200);

    await expect(adminLink).toBeHidden({ timeout: 15_000 });
  });
});
