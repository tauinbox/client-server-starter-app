import { REGIONS } from '@app/shared/constants';
import type { MockUser } from '../fixtures/mock-data';
import { expect, test, type RegionMock } from '../fixtures/regions.fixture';

const NEW_PASSWORD = 'Quartz-Meadow-77';

type TokenMap = {
  emailVerificationTokens: Record<string, string>;
  passwordResetTokens: Record<string, string>;
};

/**
 * Creates a resident of the region in its instance and answers the token
 * that the instance mails after `mailRoute`. The calls go straight to the
 * instance, as a mail of the pool of the region would.
 */
async function mailedToken(
  { region, url }: RegionMock,
  {
    mailRoute,
    tokens
  }: {
    mailRoute: 'forgot-password' | 'resend-verification';
    tokens: keyof TokenMap;
  }
): Promise<string> {
  const [residenceCountry] = REGIONS[region].countries;
  const user = {
    id: `mailed-${region}`,
    email: `mailed-${region}@example.com`,
    name: 'Mailed Resident',
    password: 'Password1',
    isActive: true,
    roles: ['user'],
    isEmailVerified: mailRoute === 'forgot-password',
    failedLoginAttempts: 0,
    lockedUntil: null,
    locale: 'en',
    residenceCountry,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z'
  } satisfies Partial<MockUser>;

  await fetch(`${url}/__control/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([user])
  });
  await fetch(`${url}/api/v1/auth/${mailRoute}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email })
  });

  const map = (await (
    await fetch(`${url}/__control/tokens`)
  ).json()) as TokenMap;
  const entry = Object.entries(map[tokens]).find(([, id]) => id === user.id);

  expect(entry, `a ${tokens} entry for ${user.id}`).toBeTruthy();

  return entry![0];
}

// One SPA serves every region, and a mailed token exists only in the pool of
// the region that mailed it. So the link names the region, and the page sends
// the token to the API host of that region.
test.describe('A mailed link of a region whose API has its own host', () => {
  test('resets the password on the host of the region', async ({
    page,
    regions
  }) => {
    for (const mock of regions) {
      const { region, apiOrigin } = mock;
      const token = await mailedToken(mock, {
        mailRoute: 'forgot-password',
        tokens: 'passwordResetTokens'
      });

      await page.goto(`/reset-password?token=${token}&region=${region}`);
      await page.getByLabel('New password').fill(NEW_PASSWORD);
      await page.getByLabel('Confirm password').fill(NEW_PASSWORD);

      const reset = page.waitForResponse(
        (res) =>
          res.url() === `${apiOrigin}/api/v1/auth/reset-password` &&
          res.request().method() === 'POST'
      );

      await page.getByRole('button', { name: 'Reset password' }).click();

      expect((await reset).ok()).toBe(true);
      await expect(page).toHaveURL(/\/login\?/);
    }
  });

  test('verifies the email on the host of the region', async ({
    page,
    regions
  }) => {
    for (const mock of regions) {
      const { region, apiOrigin } = mock;
      const token = await mailedToken(mock, {
        mailRoute: 'resend-verification',
        tokens: 'emailVerificationTokens'
      });
      const verified = page.waitForResponse(
        (res) =>
          res.url() === `${apiOrigin}/api/v1/auth/verify-email` &&
          res.request().method() === 'POST'
      );

      await page.goto(`/verify-email?token=${token}&region=${region}`);

      expect((await verified).ok()).toBe(true);
      await expect(
        page.getByRole('heading', { name: 'Email verified successfully' })
      ).toBeVisible();
    }
  });
});
