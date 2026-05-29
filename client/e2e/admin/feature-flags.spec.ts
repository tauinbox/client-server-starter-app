import { expect, loginViaUiKeepSse, test } from '../fixtures/base.fixture';

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
      id: '100',
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

  test('GET /feature-flags as anonymous issues nxs_anon_id and returns only public flags', async ({
    _mockServer
  }) => {
    // Talk to mock-server directly via the worker fixture URL — the page.route
    // /api/ rewriter only applies to browser-initiated requests, not to
    // Node-side fetch from the test process. Anon-id middleware fires globally
    // in mock-server's app.ts so the first request issues Set-Cookie regardless
    // of route.
    const first = await fetch(`${_mockServer.url}/api/v1/feature-flags`);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      flags: Record<string, boolean>;
    };
    // Default seed flags are not public → anon sees an empty map.
    expect(firstBody.flags).toEqual({});

    const setCookie = first.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('nxs_anon_id=');

    // Extract the issued anon-id and replay it on the second request — the
    // cookie value must survive a round-trip so percentage bucketing stays
    // sticky across reloads.
    const anonIdMatch = /nxs_anon_id=([^;]+)/.exec(setCookie);
    expect(anonIdMatch).not.toBeNull();
    const anonId = anonIdMatch![1];

    const second = await fetch(`${_mockServer.url}/api/v1/feature-flags`, {
      headers: { Cookie: `nxs_anon_id=${anonId}` }
    });
    expect(second.status).toBe(200);
    // Server must NOT re-issue the cookie on subsequent requests with a valid
    // anon-id already present.
    expect(second.headers.get('set-cookie') ?? '').not.toContain(
      'nxs_anon_id='
    );
  });
});
