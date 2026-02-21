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
    isAdmin: overrides.isAdmin ?? false,
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
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Login' }).click();
  await page.waitForURL(/.*\/profile$/);
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
  await loginViaUi(page, mockServerUrl, { isAdmin: false });
  await page.goto(url);
  await expect(page).toHaveURL(/.*\/forbidden/);
}
