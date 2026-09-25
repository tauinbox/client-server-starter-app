import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { Result } from 'axe-core';
import { mockId } from './fixtures/ids';

import { expect, loginViaUi, test } from './fixtures/base.fixture';

/**
 * axe-core accessibility audit — runs against each major route and fails on
 * serious / critical WCAG violations. Part of the standard E2E suite.
 */

function buildAxeScanner(page: Page) {
  return new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa'
  ]);
}

function seriousOrCritical(violations: Result[]): Result[] {
  return violations.filter((v) => ['serious', 'critical'].includes(v.impact!));
}

test.describe('Accessibility (axe-core)', () => {
  // An axe scan is CPU-bound and competes with the other parallel workers, so
  // these tests cost ~3x more in a full run than on their own: the heaviest
  // page (the users list) measures ~9s with a single worker and ~21-28s under
  // the parallel suite, which repeatedly grazed the 30s default.
  test.describe.configure({ timeout: 60_000 });

  /* ------------------------------------------------------------------
   * Public routes (no auth required)
   * ----------------------------------------------------------------*/

  test('login page has no serious a11y violations', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const { violations } = await buildAxeScanner(page).analyze();
    expect(seriousOrCritical(violations)).toEqual([]);
  });

  test('register page has no serious a11y violations', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/register');
    await page.waitForLoadState('networkidle');

    const { violations } = await buildAxeScanner(page).analyze();
    expect(seriousOrCritical(violations)).toEqual([]);
  });

  test('forgot-password page has no serious a11y violations', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/forgot-password');
    await page.waitForLoadState('networkidle');

    const { violations } = await buildAxeScanner(page).analyze();
    expect(seriousOrCritical(violations)).toEqual([]);
  });

  /* ------------------------------------------------------------------
   * Authenticated routes (regular user)
   * ----------------------------------------------------------------*/

  test('profile page has no serious a11y violations', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);
    // loginViaUi already lands on /profile

    const { violations } = await buildAxeScanner(page).analyze();
    expect(seriousOrCritical(violations)).toEqual([]);
  });

  // The scan above passes or fails on timing alone: it reported the session
  // list spinner only when it ran before the list arrived. This one holds the
  // list so the spinner is always on screen during the scan.
  test('profile page has no serious a11y violations while sessions load', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/v1/auth/sessions', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await held;
      return route.fallback();
    });
    await page.reload();
    const spinner = page.locator('.sessions-loading mat-spinner');
    await expect(spinner).toBeVisible();
    // A raw key would also satisfy axe, so the text is asserted too.
    await expect(spinner).toHaveAttribute('aria-label', 'Loading...');

    const { violations } = await buildAxeScanner(page)
      .include('.sessions-loading')
      .analyze();
    release();

    expect(seriousOrCritical(violations)).toEqual([]);
  });

  /* ------------------------------------------------------------------
   * Authenticated routes (admin)
   * ----------------------------------------------------------------*/

  test('users list page has no serious a11y violations', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');
    await page.waitForLoadState('networkidle');

    const { violations } = await buildAxeScanner(page).analyze();
    expect(seriousOrCritical(violations)).toEqual([]);
  });

  test('user detail page has no serious a11y violations', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto(`/users/${mockId('user-1')}`);
    await page.waitForLoadState('networkidle');

    const { violations } = await buildAxeScanner(page).analyze();
    expect(seriousOrCritical(violations)).toEqual([]);
  });

  test('user edit page has no serious a11y violations', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto(`/users/${mockId('user-1')}/edit`);
    await page.waitForLoadState('networkidle');

    const { violations } = await buildAxeScanner(page).analyze();
    expect(seriousOrCritical(violations)).toEqual([]);
  });

  test('admin roles page has no serious a11y violations', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/admin/roles');
    await page.waitForLoadState('networkidle');

    const { violations } = await buildAxeScanner(page).analyze();
    expect(seriousOrCritical(violations)).toEqual([]);
  });

  test('admin resources page has no serious a11y violations', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/admin/resources');
    await page.waitForLoadState('networkidle');

    const { violations } = await buildAxeScanner(page).analyze();
    expect(seriousOrCritical(violations)).toEqual([]);
  });
});
