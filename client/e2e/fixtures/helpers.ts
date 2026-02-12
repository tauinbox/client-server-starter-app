import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

import type { MockUser } from './mock-data';
import { mockLogin, mockProfile, mockRefreshToken } from './mocks/auth.mocks';

export async function loginViaUi(
  page: Page,
  user: Partial<MockUser> = {}
): Promise<void> {
  await mockLogin(page, user);
  await mockRefreshToken(page, user);
  await mockProfile(page, user);
  await page.goto('/login');
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByLabel('Password').fill('password123');
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
  url: string
): Promise<void> {
  await loginViaUi(page, { isAdmin: false });
  await page.goto(url);
  await expect(page).toHaveURL(/.*\/forbidden/);
}
