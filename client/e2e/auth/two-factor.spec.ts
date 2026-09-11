import { expect, loginViaUi, test } from '../fixtures/base.fixture';
import {
  MOCK_RECOVERY_CODES,
  MOCK_REGENERATED_RECOVERY_CODES,
  MOCK_TOTP_CODE
} from '../../../mock-server/src/constants';
import { MAX_FAILED_ATTEMPTS } from '@app/shared/constants';
import type { MockAuditLog } from '../../../mock-server/src/types';
import type { Page } from '@playwright/test';

const EMAIL = 'testlogin@example.com';
const PASSWORD = 'Password1';
/** The id `loginViaUi` seeds the account under. */
const USER_ID = '100';

/** Fails the run on a horizontal overflow, at every width and both schemes. */
async function expectNoOverflow(page: Page, panel: string): Promise<void> {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [375, 768, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      );
      expect(
        overflow,
        `horizontal overflow on ${panel} at ${width}px in ${colorScheme}`
      ).toBeLessThanOrEqual(0);
    }
  }
  await page.setViewportSize({ width: 1366, height: 900 });
}

async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: /John Doe/i }).click();
  await page.getByRole('menuitem', { name: /Logout/i }).click();
  await page.waitForURL(/\/login/);
}

/**
 * The mock accepts one fixed code on purpose: a real time-based code would tie
 * every run of this file to the clock.
 */
test.describe('two-factor authentication', () => {
  test('is enrolled from the profile page and then guards the sign-in', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    const card = page.locator('nxs-two-factor');
    await expect(card).toBeVisible();
    await expect(
      card.getByText('Two-factor authentication is off')
    ).toBeVisible();

    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.locator('.two-factor-qr')).toBeVisible();
    await expect(page.getByText('Cannot scan?')).toBeVisible();

    await page.getByLabel('Authentication code').fill(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Turn on' }).click();

    // The recovery codes are shown exactly once, here.
    await expect(page.getByText(MOCK_RECOVERY_CODES[0])).toBeVisible();
    await page.getByRole('button', { name: 'I saved them' }).click();
    await expect(
      card.getByText('Two-factor authentication is on')
    ).toBeVisible();

    await logout(page);

    // The enrolment spent that code and a code is single use. A real
    // authenticator shows the next one 30 seconds later; clearing the ledger
    // is that wait, without the sleep.
    await _mockServer.clearTotpLedger(USER_ID);

    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('main').getByRole('button', { name: 'Login' }).click();

    // The password alone does not sign in any more.
    await expect(page).toHaveURL(/\/login/);
    const codeField = page.getByLabel('Authentication code');
    await expect(codeField).toBeVisible();

    await codeField.fill('000000');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    await codeField.fill(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  });

  test('lets a recovery code in once and refuses it afterwards', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Authentication code').fill(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByRole('button', { name: 'I saved them' }).click();
    await logout(page);

    async function signInWithRecoveryCode(): Promise<void> {
      await page.getByLabel('Email').fill(EMAIL);
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await page
        .getByRole('main')
        .getByRole('button', { name: 'Login' })
        .click();
      await page.getByRole('button', { name: 'Use a recovery code' }).click();
      await page.getByLabel('Recovery code').fill(MOCK_RECOVERY_CODES[0]);
      await page.getByRole('button', { name: 'Verify' }).click();
    }

    await signInWithRecoveryCode();
    await page.waitForURL((url) => !url.pathname.endsWith('/login'));

    await logout(page);

    await signInWithRecoveryCode();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('replaces the recovery set and retires the codes it replaced', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Authentication code').fill(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByText(MOCK_RECOVERY_CODES[0])).toBeVisible();
    await page.getByRole('button', { name: 'I saved them' }).click();

    await page.getByRole('button', { name: 'New recovery codes' }).click();
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Get new codes' }).click();

    await expect(
      page.getByText(MOCK_REGENERATED_RECOVERY_CODES[0])
    ).toBeVisible();
    await expect(page.getByText(/replace the earlier set/i)).toBeVisible();
    await page.getByRole('button', { name: 'I saved them' }).click();

    await logout(page);

    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('main').getByRole('button', { name: 'Login' }).click();
    await page.getByRole('button', { name: 'Use a recovery code' }).click();

    // A refused code leaves the card on this step, so both codes are tried
    // against the one challenge the password bought.
    const codeField = page.getByLabel('Recovery code');

    // The set the enrolment issued died with the replacement.
    await codeField.fill(MOCK_RECOVERY_CODES[0]);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    await codeField.fill(MOCK_REGENERATED_RECOVERY_CODES[0]);
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  });

  // The brake is per account, so it is the one the code step can hit with no
  // help from a throttle. This also proves the key the server ships reaches the
  // screen as text: an untranslated key renders as a raw dot path.
  test('bars the code step after too many wrong codes and keeps recovery open', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Authentication code').fill(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByRole('button', { name: 'I saved them' }).click();
    await logout(page);
    await _mockServer.clearTotpLedger(USER_ID);

    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('main').getByRole('button', { name: 'Login' }).click();

    const codeField = page.getByLabel('Authentication code');
    await expect(codeField).toBeVisible();

    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      await codeField.fill('000000');
      await page.getByRole('button', { name: 'Verify' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
    }

    await expect(page.getByRole('alert')).toContainText(
      /Too many incorrect verification codes/i
    );

    // The correct code buys nothing while the window is open.
    await codeField.fill(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/login/);

    // The way back in that the brake never closes.
    await page.getByRole('button', { name: 'Use a recovery code' }).click();
    await page.getByLabel('Recovery code').fill(MOCK_RECOVERY_CODES[0]);
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  });

  // A wrong enrolment code is answered with 401, the same status an expired
  // session carries. The interceptor must read it as a verdict on the code:
  // a refresh here replays the same wrong code, so one mistyped code costs two
  // attempts of the account budget and rotates the refresh cookie for nothing.
  test('spends one attempt and no refresh on a wrong enrolment code', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('.two-factor-qr')).toBeVisible();

    const calls: string[] = [];
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (
        pathname.endsWith('/auth/mfa/enable') ||
        pathname.endsWith('/auth/refresh-token')
      ) {
        calls.push(`${request.method()} ${pathname}`);
      }
    });

    await page.getByLabel('Authentication code').fill('000000');
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.locator('mat-snack-bar-container')).toBeVisible();

    expect(calls).toEqual(['POST /api/v1/auth/mfa/enable']);

    const state = await _mockServer.getState();
    const failures = (state.auditLogs as MockAuditLog[]).filter(
      (row) => row.action === 'MFA_CHALLENGE_FAILURE'
    );
    expect(failures).toHaveLength(1);

    // The card stays on the code step, so the correct code still enrols.
    await _mockServer.clearTotpLedger(USER_ID);
    await page.getByLabel('Authentication code').fill(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByText(MOCK_RECOVERY_CODES[0])).toBeVisible();
  });

  test('renders every panel without overflow at every width', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('.two-factor-qr')).toBeVisible();
    await page.getByLabel('Authentication code').fill(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByText(MOCK_RECOVERY_CODES[0])).toBeVisible();

    await expectNoOverflow(page, 'the codes panel');

    await page.getByRole('button', { name: 'I saved them' }).click();
    // The card carries two buttons once the factor is on, and the narrow
    // widths are where that row has to wrap.
    await expect(
      page.getByRole('button', { name: 'New recovery codes' })
    ).toBeVisible();
    await expectNoOverflow(page, 'the enabled card');

    await page.getByRole('button', { name: 'New recovery codes' }).click();
    await expect(page.getByLabel('Current password')).toBeVisible();
    await expectNoOverflow(page, 'the replacement panel');
  });
});
