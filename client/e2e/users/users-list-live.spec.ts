import type { Page } from '@playwright/test';
import { expect, loginViaUiKeepSse, test } from '../fixtures/base.fixture';
import { createMockUser } from '../fixtures/mock-data';
import { mockId } from '../fixtures/ids';

const SEEDED = 25;

// The newest users, so that the default newest-first sort puts `live-00` on
// the second page.
const seededUsers = Array.from({ length: SEEDED }, (_, index) => {
  const n = String(index).padStart(2, '0');
  return createMockUser({
    id: mockId(`live-${n}`),
    email: `live-${n}@example.com`,
    name: `Live${n} Member`,
    createdAt: `2030-01-01T00:00:${n}.000Z`,
    updatedAt: `2030-01-01T00:00:${n}.000Z`
  });
});

async function openListWithStream(page: Page, mockServerUrl: string) {
  await page.unroute(/\/api\/.*\/notifications\/stream/);
  await loginViaUiKeepSse(page, mockServerUrl, { roles: ['admin'] });
  const stream = page.waitForRequest((r) =>
    r.url().includes('/api/v1/notifications/stream')
  );
  await page.goto('/users');
  await stream;
}

/** Counts the list requests that start from the first page. */
function countFirstPageLoads(page: Page): () => number {
  let count = 0;
  page.on('request', (request) => {
    const url = request.url();
    if (
      url.includes('/api/v1/users/') &&
      url.includes('cursor') &&
      !url.includes('cursor=')
    ) {
      count++;
    }
  });
  return () => count;
}

async function adminToken(mockServerUrl: string): Promise<string> {
  const login = await fetch(`${mockServerUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Password1' })
  });
  const { tokens } = (await login.json()) as {
    tokens: { access_token: string };
  };
  return tokens.access_token;
}

test.describe('User list - live changes', () => {
  test('a change of a user on the second page updates its row and keeps the loaded pages', async ({
    _mockServer,
    page
  }) => {
    await _mockServer.seedUsers(seededUsers);
    await openListWithStream(page, _mockServer.url);

    const rows = page.locator('tr.mat-mdc-row');
    const target = rows.filter({ hasText: 'live-00@example.com' });
    await expect(rows.first()).toBeVisible();
    // The scroll sentinel loads the second page.
    await expect(async () => {
      await rows.last().scrollIntoViewIfNeeded();
      await expect(target).toHaveCount(1, { timeout: 1000 });
    }).toPass();
    await expect(target).toContainText('Live00 Member');
    const firstPageLoads = countFirstPageLoads(page);

    const token = await adminToken(_mockServer.url);
    const patch = await fetch(
      `${_mockServer.url}/api/v1/users/${mockId('live-00')}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: 'Renamed Member' })
      }
    );
    expect(patch.status).toBe(200);

    // The row is on the second page, so a reload would have dropped it.
    await expect(target).toContainText('Renamed Member');
    expect(firstPageLoads()).toBe(0);
    await expect(page.getByText('The user list has changed.')).toHaveCount(0);
  });

  test('a new user shows the stale banner, and its refresh action loads the list again', async ({
    _mockServer,
    page
  }) => {
    await openListWithStream(page, _mockServer.url);

    const rows = page.locator('tr.mat-mdc-row');
    await expect(rows.first()).toBeVisible();
    const firstPageLoads = countFirstPageLoads(page);

    const register = await fetch(`${_mockServer.url}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newcomer@example.com',
        password: 'Tq7-vRw2-Lp9z',
        name: 'Newcomer Person'
      })
    });
    expect(register.status).toBe(201);

    const banner = page.getByRole('status').filter({
      hasText: 'The user list has changed.'
    });
    await expect(banner).toBeVisible();
    expect(firstPageLoads()).toBe(0);
    await expect(page.getByText('newcomer@example.com')).toHaveCount(0);

    await banner.getByRole('button', { name: 'Refresh' }).click();

    await expect(banner).toHaveCount(0);
    expect(firstPageLoads()).toBe(1);
    await expect(page.getByText('newcomer@example.com')).toBeVisible();
  });

  test('a new user registered while the stream reconnects shows the stale banner', async ({
    _mockServer,
    _workerMockServer,
    page
  }) => {
    await openListWithStream(page, _mockServer.url);
    await expect(page.locator('tr.mat-mdc-row').first()).toBeVisible();

    const reconnect = page.waitForRequest((r) =>
      r.url().includes('/api/v1/notifications/stream')
    );
    _workerMockServer.server.closeAllConnections();
    // The client waits at least 1.5 s before it reconnects, so the push of
    // this registration goes to no open stream.
    const register = await fetch(`${_mockServer.url}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'gap-newcomer@example.com',
        password: 'Tq7-vRw2-Lp9z',
        name: 'Gap Newcomer'
      })
    });
    expect(register.status).toBe(201);
    await reconnect;

    await expect(
      page.getByRole('status').filter({
        hasText: 'The user list has changed.'
      })
    ).toBeVisible();
  });
});
