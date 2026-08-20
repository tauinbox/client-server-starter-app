import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import type { MockUser } from './mock-data';

/**
 * Wait for a freshly opened dialog to be visible AND for its CDK focus trap to
 * have moved focus inside it. Use instead of a bare
 * `expect(page.getByRole('dialog')).toBeVisible()` before typing into a dialog.
 *
 * A dialog becomes visible ~150ms before it is safe to type into: MatDialog
 * defers `_trapFocus()` to `_openAnimationDone` (delayFocusTrap is true by
 * default), which then focuses the dialog's first tabbable element. Playwright's
 * `fill()` is two round trips - an in-page `select() + focus()`, then a separate
 * `Input.insertText` that goes to whatever holds focus at that later moment. A
 * trap firing between the two appends the text to the first field and leaves the
 * intended one empty but touched, i.e. showing a "required" error. Waiting for
 * the trap first closes that window.
 *
 * Focus landing inside the dialog is a reliable signal that the trap has run:
 * no dialog in this app declares `cdkFocusInitial` or focuses a control itself,
 * so nothing else moves focus off the trigger button.
 */
export async function openedDialog(page: Page): Promise<Locator> {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((el) => el.contains(el.ownerDocument.activeElement))
    )
    .toBe(true);
  return dialog;
}

/**
 * Point a page's `/api` traffic at the worker's mock server and stub the SSE
 * stream with an empty body. `base.fixture` applies this to the fixture `page`;
 * a test that opens a second tab must apply it to that tab itself, because
 * routes are registered per page, not per context.
 */
export async function routeApiToMockServer(
  page: Page,
  mockServerUrl: string
): Promise<void> {
  const { port } = new URL(mockServerUrl);

  await page.route(/\/api\//, (route) => {
    const url = route
      .request()
      .url()
      .replace(/localhost:\d+/, `localhost:${port}`);
    return route.continue({ url });
  });

  // A persistent SSE connection blocks waitForLoadState('networkidle') in
  // loginViaUi() because Playwright counts streaming XHR as active until the
  // connection closes. Registered after the general route so it takes priority
  // (Playwright: last = first matched).
  await page.route(/\/api\/.*\/notifications\/stream/, (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache'
      },
      body: ''
    })
  );
}

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
    locale: overrides.locale ?? 'en',
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
  // Post-login destination depends on permissions (admin → /admin/users via
  // root redirect → defaultRoute(); user → /profile fallback).
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  await page.waitForLoadState('networkidle');
  // Tests written before the dynamic landing page rely on /profile being the
  // post-login URL; normalize so existing assertions keep working.
  if (!page.url().endsWith('/profile')) {
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');
  }
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
    locale: overrides.locale ?? 'en',
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
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  await permissionsResponse;
  await sseRequest;
}
