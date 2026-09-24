import { expect, loginViaUiKeepSse, test } from '../fixtures/base.fixture';
import { mockId } from '../fixtures/ids';

// When an admin toggles a flag in the admin panel, the server (or mock-server
// in this case) broadcasts `{ type: 'feature_flags_updated' }` to every
// connected SSE consumer. The client's `NotificationsService` translates that
// into a `featureFlagsUpdated$` emission, which `AuthService` listens to and
// calls `featureFlagsStore.reload()`. The downstream effect is a fresh
// `GET /api/v1/feature-flags` request, with the new evaluated state landing
// in the store without a page reload.
//
// This spec exercises that pipeline end-to-end through the real SSE stream
// (the empty-body stub from base.fixture is dropped via `page.unroute`).
test.describe('Feature flags — SSE-driven reload after admin toggle', () => {
  test('toggling new-dashboard from disabled to enabled fires SSE → store re-fetches', async ({
    _mockServer,
    page
  }) => {
    // Need the real SSE stream — drop the empty-body stub.
    await page.unroute(/\/api\/.*\/notifications\/stream/);

    await loginViaUiKeepSse(page, _mockServer.url, {
      id: mockId('user-100'),
      email: 'flagadmin@example.com',
      roles: ['admin']
    });

    // The mock-server seeds `flag-new-dashboard` with enabled: false. After
    // login the bootstrap fetches /api/v1/feature-flags once, which lands in
    // the store as `{ 'new-dashboard': false, 'beta-export': <bucket> }`.

    // Land on the admin feature flags page so the toggle button is reachable.
    await page.goto('/admin/feature-flags');
    await expect(page.getByText('new-dashboard')).toBeVisible();

    // The toggle button carries an aria-label like "Toggle flag new-dashboard".
    const toggleBtn = page.getByRole('button', {
      name: /Toggle flag new-dashboard/i
    });
    await expect(toggleBtn).toBeVisible();

    // Wait for the SSE-driven re-fetch that follows the toggle. The bootstrap
    // call already happened; the next /feature-flags hit can only come from
    // `featureFlagsStore.reload()` triggered by the SSE handler.
    const reloadResponse = page.waitForResponse(
      (r) => r.url().includes('/api/v1/feature-flags') && r.status() === 200,
      { timeout: 15_000 }
    );

    await toggleBtn.click();

    // new-dashboard has no include rules, so enabling it prompts the
    // "enable for everyone" confirmation before the toggle is sent.
    await page
      .getByRole('button', { name: 'Confirm' })
      .click({ timeout: 5_000 });

    const response = await reloadResponse;
    const body = (await response.json()) as {
      flags: Record<string, boolean>;
      evaluatedAt: string;
    };
    expect(body.flags['new-dashboard']).toBe(true);

    // List itself reflects the change too — admin store has been updated by
    // the toggle response, switching the row's status chip to "Enabled".
    const newDashboardRow = page.getByRole('row', {
      name: /new-dashboard/
    });
    await expect(newDashboardRow.getByText('Enabled')).toBeVisible({
      timeout: 5_000
    });
  });

  test('GET /feature-flags as anonymous returns only public flags and issues no nxs_anon_id', async ({
    _mockServer
  }) => {
    // Talk to mock-server directly via the worker fixture URL - the page.route
    // /api/ rewriter only applies to browser-initiated requests, not to
    // Node-side fetch from the test process.
    const res = await fetch(`${_mockServer.url}/api/v1/feature-flags`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { flags: Record<string, boolean> };
    // Private seed flags (new-dashboard, beta-export) are not public, so anon
    // sees only the public OAuth provider flags and the billing flag - all of
    // which resolve true because the mock environment marks every provider
    // configured.
    expect(body.flags).toEqual({
      'oauth-google': true,
      'oauth-facebook': true,
      'oauth-vk': true,
      billing: true
    });
    // No public seed flag has a percentage rule, so nothing reads a rollout id
    // and none is issued. The only seed percentage rule is on private
    // beta-export.
    expect(res.headers.get('set-cookie')).toBeNull();

    const health = await fetch(`${_mockServer.url}/api/health/live`);
    expect(health.headers.get('set-cookie')).toBeNull();
  });

  test('a public percentage flag added by an admin makes /feature-flags issue a sticky nxs_anon_id', async ({
    _mockServer
  }) => {
    const login = await fetch(`${_mockServer.url}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'Password1'
      })
    });
    expect(login.status).toBe(200);
    const { tokens } = (await login.json()) as {
      tokens: { access_token: string };
    };
    const adminHeaders = {
      Authorization: `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json'
    };

    const created = await fetch(
      `${_mockServer.url}/api/v1/admin/feature-flags`,
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          key: 'public-rollout',
          enabled: true,
          public: true
        })
      }
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const rules = await fetch(
      `${_mockServer.url}/api/v1/admin/feature-flags/${id}/rules`,
      {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({
          rules: [
            {
              type: 'percentage',
              effect: 'include',
              payload: { type: 'percentage', percent: 100 }
            }
          ]
        })
      }
    );
    expect(rules.status).toBe(200);

    const first = await fetch(`${_mockServer.url}/api/v1/feature-flags`);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      flags: Record<string, boolean>;
    };
    // percent 100: true only if the evaluation used the id it just issued.
    expect(firstBody.flags['public-rollout']).toBe(true);
    const anonIdMatch = /nxs_anon_id=([0-9a-f-]{36});/.exec(
      first.headers.get('set-cookie') ?? ''
    );
    expect(anonIdMatch).not.toBeNull();

    // The value must survive a round-trip so percentage bucketing stays
    // sticky across reloads, and a held id is never re-issued.
    const second = await fetch(`${_mockServer.url}/api/v1/feature-flags`, {
      headers: { Cookie: `nxs_anon_id=${anonIdMatch![1]}` }
    });
    expect(second.status).toBe(200);
    expect(second.headers.get('set-cookie')).toBeNull();
  });
});
