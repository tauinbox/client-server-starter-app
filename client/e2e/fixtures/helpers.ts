import type { Locator, Page, Response } from '@playwright/test';
import { expect } from '@playwright/test';

import type { MockUser } from './mock-data';
import {
  trackRoutedRequest,
  trackSentRequest,
  untrackRequest
} from './pending-requests';

const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * Stubs the global `turnstile` API. The real script is never loaded; instead
 * the route returns a tiny shim that mounts a button into the host container.
 * Pressing the button fires the Turnstile callback with a deterministic token
 * that the mock-server accepts.
 */
export async function stubTurnstile(page: Page): Promise<void> {
  await page.route(`${TURNSTILE_SCRIPT_URL}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.turnstile = {
          render: function (container, options) {
            const el = typeof container === 'string'
              ? document.querySelector(container)
              : container;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.testid = 'fake-turnstile';
            btn.textContent = 'Solve CAPTCHA';
            btn.addEventListener('click', function () {
              if (options && typeof options.callback === 'function') {
                options.callback('test-token');
              }
            });
            el.appendChild(btn);
            return 'widget-1';
          },
          reset: function () {},
          remove: function () {},
          getResponse: function () { return undefined; }
        };
      `
    })
  );
}

/**
 * Stores what a click on a provider button stores just before the browser
 * leaves for the provider. Call it on a page that has already bootstrapped:
 * the app takes the value out of storage at bootstrap, so it must be written
 * after that and read by the NEXT page load, which is why this is not an
 * `addInitScript`.
 */
export async function markOAuthRoundTripStarted(
  page: Page,
  returnUrl = '/profile'
): Promise<void> {
  await page.evaluate(
    (url) => sessionStorage.setItem('oauth_return_url', url),
    returnUrl
  );
}

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
 * A one-shot count. Call it after the in-page error is visible: the global
 * error snackbar opens before that error renders, and a retrying
 * `toHaveCount(0)` would pass once the snackbar dismissed itself.
 */
export async function expectNoSnackbar(page: Page): Promise<void> {
  expect(await page.locator('mat-snack-bar-container').count()).toBe(0);
}

/**
 * Waits for the list response whose request carries every one of `params`. A
 * list filter applies by itself (the search after a pause in typing), so a test
 * waits for this where it once clicked a Search button. Start the wait before
 * the action that sends the request.
 */
export function listResponse(
  page: Page,
  path: string,
  params: Readonly<Record<string, string>>
): Promise<Response> {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());

    return (
      url.pathname.endsWith(path) &&
      Object.entries(params).every(
        ([name, value]) => url.searchParams.get(name) === value
      )
    );
  });
}

/**
 * Picks an option of a mat-select and waits until its panel is gone. A select
 * reopened while its last panel still animates out does not open, and the
 * option it finds is the one of the closing panel, which never becomes
 * stable: the test then times out on a slow runner only.
 */
export async function chooseOption(
  page: Page,
  select: string,
  option: string
): Promise<void> {
  await page.getByRole('combobox', { name: select, exact: true }).click();
  const panel = page.getByRole('listbox', { name: select, exact: true });

  await panel.getByRole('option', { name: option, exact: true }).click();
  await expect(panel).toHaveCount(0);
}

/** The URL of a browser `/api` request, moved to the worker's mock server. */
export function mockServerUrlOf(
  requestUrl: string,
  mockServerUrl: string
): string {
  const { port } = new URL(mockServerUrl);

  return requestUrl.replace(/localhost:\d+/, `localhost:${port}`);
}

export type RecordedApiCall<T> = {
  method: string;
  status: number;
  requestBody: unknown;
  body: T;
};

/**
 * Records each browser `/api` call that matches `pattern`, with its JSON body.
 * Use it instead of `(await page.waitForResponse(...)).json()`: Chromium can
 * drop the body of a routed response before the test asks for it ("No data
 * found for resource", 2 of 25 runs of `feature-flags.spec.ts`).
 */
export async function recordApiCalls<T>(
  page: Page,
  pattern: RegExp,
  mockServerUrl: string
): Promise<RecordedApiCall<T>[]> {
  const calls: RecordedApiCall<T>[] = [];

  await page.route(pattern, async (route) => {
    const request = route.request();
    const response = await route.fetch({
      url: mockServerUrlOf(request.url(), mockServerUrl)
    });
    const body = await response.text();

    calls.push({
      method: request.method(),
      status: response.status(),
      requestBody: request.postDataJSON(),
      body: JSON.parse(body) as T
    });
    await route.fulfill({ response, body });
  });

  return calls;
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
  page.on('request', (request) => {
    if (/\/api\//.test(request.url())) {
      trackSentRequest(page, request);
    }
  });
  page.on('requestfinished', untrackRequest);
  page.on('requestfailed', untrackRequest);
  await page.route(/\/api\//, (route) => {
    trackRoutedRequest(page, route.request());

    return route.continue({
      url: mockServerUrlOf(route.request().url(), mockServerUrl)
    });
  });

  // Most tests do not need live notifications, so the SSE stream gets an empty
  // body instead of a connection that stays open. Registered after the general
  // route so it takes priority (Playwright: last = first matched).
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

type LoginCredentials = { email: string; password: string; name: string };

async function seedLoginUser(
  mockServerUrl: string,
  overrides: Partial<MockUser>
): Promise<LoginCredentials> {
  const email = overrides.email ?? 'testlogin@example.com';
  const password = 'Password1';
  const user = {
    id: overrides.id ?? '100',
    email,
    name: overrides.name ?? 'John Doe',
    password,
    isActive: overrides.isActive ?? true,
    roles: overrides.roles ?? ['user'],
    isEmailVerified: overrides.isEmailVerified ?? true,
    failedLoginAttempts: overrides.failedLoginAttempts ?? 0,
    lockedUntil: overrides.lockedUntil ?? null,
    locale: overrides.locale ?? 'en',
    residenceCountry: overrides.residenceCountry,
    createdAt: overrides.createdAt ?? '2025-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2025-01-01T00:00:00.000Z'
  };

  await fetch(`${mockServerUrl}/__control/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([user])
  });

  return { email, password, name: user.name };
}

/**
 * Seed a test user in mock-server state, sign it in through the API and open
 * `/profile`. A test of the login form fills the form itself.
 */
export async function loginViaApi(
  page: Page,
  mockServerUrl: string,
  overrides: Partial<MockUser> = {}
): Promise<void> {
  const { email, password, name } = await seedLoginUser(
    mockServerUrl,
    overrides
  );

  // The context request shares the cookie jar of the page, and a cookie
  // ignores the port, so the refresh cookie reaches the app origin too.
  const response = await page
    .context()
    .request.post(`${mockServerUrl}/api/v1/auth/login`, {
      data: { email, password }
    });

  expect(response.status()).toBe(200);
  const { user: signedIn } = (await response.json()) as { user: unknown };

  // The app restores a session at bootstrap only when it finds the persisted
  // user. A static file of the same origin gives access to its storage
  // without a bootstrap of the app.
  await page.goto('/assets/i18n/en.json');
  await page.evaluate(
    (value) => localStorage.setItem('auth_user', JSON.stringify(value)),
    signedIn
  );
  await page.goto('/profile');

  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
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
  await loginViaApi(page, mockServerUrl, { roles: ['user'] });
  await page.goto(url);
  await expect(page).toHaveURL(/.*\/forbidden/);
}

/**
 * Login variant for tests that opt into the REAL `/api/.../notifications/stream`
 * SSE connection (after `page.unroute(...)` removes the empty-body stub from
 * base.fixture). Has no `goto('/profile')`, so the test stays on the landing
 * page. Waits for the `/auth/permissions` response so the CASL ability is
 * hydrated before the test continues.
 */
export async function loginViaUiKeepSse(
  page: Page,
  mockServerUrl: string,
  overrides: Partial<MockUser> = {}
): Promise<void> {
  const { email, password } = await seedLoginUser(mockServerUrl, overrides);

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
  // currently-connected users, so any push before the stream is open silently
  // drops on the floor. The request itself is fire-and-keep
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
