import { expect, loginViaUiKeepSse, test } from '../fixtures/base.fixture';

// Regression for the live-RBAC update path. Scenario: an admin (or some
// process holding the right CASL ability) revokes a user's role, the server
// emits `UserRoleChangedEvent` → `NotificationsListener` pushes a
// `permissions_updated` SSE frame, and the client must invalidate cached
// permissions and reflect the new state in the UI immediately — without a
// reload, without the user clicking anything.
//
// Given a user is logged in as admin and sees the admin link in the sidenav,
// when their role is revoked server-side and the SSE event fires,
// then the admin link must disappear from the sidenav on the next render.
test.describe('Live RBAC update via SSE', () => {
  test('admin link disappears when admin role is revoked mid-session', async ({
    _mockServer,
    page
  }) => {
    // Same trick as admin-panel-permission-loss.spec.ts: drop the empty-body
    // SSE stub so the client's NotificationsService can hold a real stream
    // open against mock-server's SSE hub.
    await page.unroute(/\/api\/.*\/notifications\/stream/);

    const userId = '100';
    await loginViaUiKeepSse(page, _mockServer.url, {
      id: userId,
      roles: ['admin']
    });

    // Land on a screen where the sidenav admin link is rendered.
    await page.goto('/users');

    const adminLink = page.getByRole('link', { name: 'Admin Panel' });
    await expect(adminLink).toBeVisible();

    // Server-side: drop the user's roles and push the SSE event without
    // revoking tokens. The client re-fetches /auth/permissions, the new
    // (empty) ability is built, and the sidenav's `canAccessAdmin` computed
    // flips false on the next change detection cycle.
    await _mockServer.changeUserRoles(userId, []);

    await expect(adminLink).toBeHidden({ timeout: 15_000 });
  });
});
