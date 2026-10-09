import { expect, test } from './fixtures/base.fixture';
import { createMockUser } from './fixtures/mock-data';
import {
  MOCK_TOTP_CODE,
  MOCK_TOTP_SECRET
} from '../../mock-server/src/constants';

const EMAIL = 'stale-chunk@example.com';
const PASSWORD = 'Password1';

/**
 * A deploy removes every lazy chunk of the old build. A page that was loaded
 * before the deploy gets a 404 for each chunk it has not fetched yet, so the
 * first navigation into a new route fails.
 */
test.describe('a page loaded before a deploy', () => {
  test('reaches the target page after a second-factor sign-in', async ({
    _mockServer,
    page
  }) => {
    await _mockServer.seedUsers([
      createMockUser({
        id: '901',
        email: EMAIL,
        firstName: 'Stale',
        lastName: 'Chunk',
        password: PASSWORD,
        roles: ['user'],
        isActive: true,
        isEmailVerified: true,
        totpSecret: MOCK_TOTP_SECRET,
        totpEnabledAt: '2026-01-01T00:00:00.000Z',
        totpRecoveryCodes: [],
        totpLastUsedStep: null
      })
    ]);

    await page.goto('/login?returnUrl=%2Fprofile');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('main').getByRole('button', { name: 'Login' }).click();
    await expect(page.getByLabel('Authentication code')).toBeVisible();

    // The deploy happens now: until the next document load, the old build has
    // no chunk on the server.
    let deployed = true;
    const missing: string[] = [];
    await page.route(/\/chunk-[^/]+\.js$/, async (route) => {
      if (deployed) {
        missing.push(route.request().url());
        await route.fulfill({ status: 404, body: 'Not Found' });
        return;
      }
      await route.fallback();
    });
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        deployed = false;
    });

    await page.getByLabel('Authentication code').fill(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Verify' }).click();

    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.locator('nxs-two-factor')).toBeVisible();
    expect(missing.length).toBeGreaterThan(0);
  });
});
