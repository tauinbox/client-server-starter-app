import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { Result } from 'axe-core';

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
    await page.goto('/users/1');
    await page.waitForLoadState('networkidle');

    const { violations } = await buildAxeScanner(page).analyze();
    expect(seriousOrCritical(violations)).toEqual([]);
  });

  test('user edit page has no serious a11y violations', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1/edit');
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
