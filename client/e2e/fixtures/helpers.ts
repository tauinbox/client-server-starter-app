import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

import type { MockUser } from './mock-data';

/**
 * Seed a test user in mock-server state and log in via the UI.
 */
export async function loginViaUi(
  page: Page,
  mockServerUrl: string,
  overrides: Partial<MockUser> = {}
): Promise<void> {
  const email = overrides.email ?? 'testlogin@example.com';
  const password = 'Password1';

  // Seed the user with desired properties via control API
  const user = {
    id: overrides.id ?? '100',
    email,
    firstName: overrides.firstName ?? 'John',
    lastName: overrides.lastName ?? 'Doe',
    password,
    isActive: overrides.isActive ?? true,
    roles: overrides.roles ?? ['user'],
    isEmailVerified: overrides.isEmailVerified ?? true,
    failedLoginAttempts: overrides.failedLoginAttempts ?? 0,
    lockedUntil: overrides.lockedUntil ?? null,
    createdAt: overrides.createdAt ?? '2025-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2025-01-01T00:00:00.000Z'
  };

  await fetch(`${mockServerUrl}/__control/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([user])
  });

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Email').blur();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Password', { exact: true }).blur();
  await page.getByRole('main').getByRole('button', { name: 'Login' }).click();
  await page.waitForURL(/.*\/profile$/);
  // Wait for the permissions fetch to complete so CASL ability is set
  // before tests navigate to permission-guarded routes or check guarded UI
  await page.waitForLoadState('networkidle');
}

export async function expectAuthRedirect(
  page: Page,
  url: string
): Promise<void> {
  await page.goto(url);
  await expect(page).toHaveURL(/.*\/login/);
}

export async function expectForbiddenRedirect(
  page: Page,
  mockServerUrl: string,
  url: string
): Promise<void> {
  await loginViaUi(page, mockServerUrl, { roles: ['user'] });
  await page.goto(url);
  await expect(page).toHaveURL(/.*\/forbidden/);
}

/**
 * Login variant for tests that opt into the REAL `/api/.../notifications/stream`
 * SSE connection (after `page.unroute(...)` removes the empty-body stub from
 * base.fixture). Skips `waitForLoadState('networkidle')` because a live SSE
 * connection stays open and never lets the page reach idle. Instead waits for
 * the `/auth/permissions` response so the CASL ability is hydrated before the
 * test continues — same end-state as `loginViaUi`.
 */
export async function loginViaUiKeepSse(
  page: Page,
  mockServerUrl: string,
  overrides: Partial<MockUser> = {}
): Promise<void> {
  const email = overrides.email ?? 'testlogin@example.com';
  const password = 'Password1';

  const user = {
    id: overrides.id ?? '100',
    email,
    firstName: overrides.firstName ?? 'John',
    lastName: overrides.lastName ?? 'Doe',
    password,
    isActive: overrides.isActive ?? true,
    roles: overrides.roles ?? ['user'],
    isEmailVerified: overrides.isEmailVerified ?? true,
    failedLoginAttempts: overrides.failedLoginAttempts ?? 0,
    lockedUntil: overrides.lockedUntil ?? null,
    createdAt: overrides.createdAt ?? '2025-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2025-01-01T00:00:00.000Z'
  };

  await fetch(`${mockServerUrl}/__control/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([user])
  });

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Email').blur();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Password', { exact: true }).blur();

  const permissionsResponse = page.waitForResponse(
    (r) => r.url().includes('/api/v1/auth/permissions') && r.status() === 200,
    { timeout: 10_000 }
  );
  // Wait for the SSE stream request to be issued — sse-hub.ts only pushes to
  // currently-connected users, so any /__control/notify call before the stream
  // is open silently drops on the floor. The request itself is fire-and-keep
  // (the body never resolves), so we wait for the request, not the response.
  const sseRequest = page.waitForRequest(
    (r) => r.url().includes('/api/v1/notifications/stream'),
    { timeout: 10_000 }
  );
  await page.getByRole('main').getByRole('button', { name: 'Login' }).click();
  await page.waitForURL(/.*\/profile$/);
  await permissionsResponse;
  await sseRequest;
}
