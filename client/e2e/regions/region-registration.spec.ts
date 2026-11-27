import type { Page } from '@playwright/test';
import { REGIONS, type DataRegion } from '@app/shared/constants';
import { chooseOption } from '../fixtures/base.fixture';
import { stubTurnstile } from '../fixtures/helpers';
import type { MockUser } from '../fixtures/mock-data';
import { expect, test } from '../fixtures/regions.fixture';

const PASSWORD = 'Quartz-Meadow-77';
const COUNTRY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

/** Opens or closes the region in the registry of the home instance. */
async function setPublic(
  homeUrl: string,
  { region, isPublic }: { region: DataRegion; isPublic: boolean }
): Promise<void> {
  const login = await fetch(`${homeUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'Password1'
    })
  });
  const {
    tokens: { access_token: token }
  } = (await login.json()) as { tokens: { access_token: string } };
  const res = await fetch(`${homeUrl}/api/v1/admin/regions/${region}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ public: isPublic })
  });

  expect(res.status).toBe(200);
}

async function usersOf(url: string): Promise<Pick<MockUser, 'email'>[]> {
  const res = await fetch(`${url}/__control/state`);

  return ((await res.json()) as { users: Pick<MockUser, 'email'>[] }).users;
}

async function fillResident(
  page: Page,
  { region, email }: { region: DataRegion; email: string }
): Promise<void> {
  const [country] = REGIONS[region].countries;

  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Full name').fill('Regional Newcomer');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await chooseOption(page, 'Country of residence', COUNTRY_NAMES.of(country)!);
}

const submit = (page: Page) =>
  page.getByRole('main').getByRole('button', { name: 'Register' }).click();

async function registerResident(
  page: Page,
  account: { region: DataRegion; email: string }
): Promise<void> {
  await fillResident(page, account);
  await submit(page);
}

type SentRequest = { origin: string; body: unknown };

/** Records the origin and the body of each request of the page to `path`. */
function recordRequests(page: Page, path: string): SentRequest[] {
  const sent: SentRequest[] = [];

  page.on('request', (request) => {
    const url = new URL(request.url());

    if (url.pathname === path) {
      sent.push({ origin: url.origin, body: request.postDataJSON() });
    }
  });

  return sent;
}

const REGISTER_PATH = '/api/v1/auth/register';

// One SPA serves every region, and the pool of the region of the declared
// country holds the personal data of the account. So a registration goes to
// the API host of that region, but only while the registry lists the region
// as public: a closed region is not open to new accounts.
test.describe('A registration with a country of a region whose API has its own host', () => {
  test('is created by the instance of that region while the region is public', async ({
    page,
    _mockServer,
    regions
  }) => {
    const sent = recordRequests(page, REGISTER_PATH);

    for (const { region, url, apiOrigin } of regions) {
      const email = `newcomer-${region}@example.com`;

      sent.length = 0;
      await setPublic(_mockServer.url, { region, isPublic: true });
      await registerResident(page, { region, email });

      await expect
        .poll(() => sent.map(({ origin }) => origin))
        .toEqual([apiOrigin]);
      await expect(page).toHaveURL(/\/login\?registered=pending-verification/);

      const emails = (users: Pick<MockUser, 'email'>[]) =>
        users.map((user) => user.email);

      expect(emails(await usersOf(url))).toContain(email);
      expect(emails(await usersOf(_mockServer.url))).not.toContain(email);
    }
  });

  test('goes to the home instance while the region is not public', async ({
    page,
    _mockServer,
    regions
  }) => {
    const sent = recordRequests(page, REGISTER_PATH);

    for (const { region, url, apiOrigin } of regions) {
      const email = `closed-${region}@example.com`;

      sent.length = 0;
      await registerResident(page, { region, email });

      await expect.poll(() => sent.length).toBe(1);
      // The home instance answers: the instance of the region would accept
      // the country.
      expect(sent[0].origin).not.toBe(apiOrigin);
      await expect(page.getByRole('main')).toContainText(
        'Accounts for this country are not available yet.'
      );
      expect((await usersOf(url)).map((user) => user.email)).not.toContain(
        email
      );
    }
  });

  // Each pool has its own captcha keys and checks only the tokens of them.
  test('shows the captcha of the pool of that region', async ({
    page,
    _mockServer,
    regions
  }) => {
    await stubTurnstile(page);

    const sent = recordRequests(page, REGISTER_PATH);
    const configReads = recordRequests(page, '/api/v1/auth/captcha-config');

    for (const { region, url, apiOrigin } of regions) {
      const email = `taken-${region}@example.com`;
      const [residenceCountry] = REGIONS[region].countries;

      sent.length = 0;
      configReads.length = 0;
      await setPublic(_mockServer.url, { region, isPublic: true });
      // A taken address keeps the form on screen after each attempt.
      await fetch(`${url}/__control/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            id: `taken-${region}`,
            email,
            name: 'Taken Resident',
            password: 'Password1',
            isActive: true,
            roles: ['user'],
            isEmailVerified: true,
            failedLoginAttempts: 0,
            lockedUntil: null,
            locale: 'en',
            residenceCountry,
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z'
          } satisfies Partial<MockUser>
        ])
      });
      // Only the pool of the region asks for a captcha.
      await fetch(`${url}/__control/captcha`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true })
      });

      await fillResident(page, { region, email });

      // The pool asks for the captcha on the fourth attempt of its window
      // (limit 5, threshold 1). A click waits for the button, which stays
      // disabled until the previous attempt has its answer.
      for (let attempt = 1; attempt <= 4; attempt++) {
        await submit(page);
        await expect.poll(() => sent.length).toBe(attempt);
      }

      expect(sent.map(({ origin }) => origin)).toEqual(
        Array.from({ length: 4 }, () => apiOrigin)
      );
      await expect
        .poll(() => configReads.map(({ origin }) => origin))
        .toEqual([apiOrigin]);

      const fake = page.getByTestId('fake-turnstile');

      await expect(fake).toBeVisible();
      await fake.click();
      await submit(page);

      await expect.poll(() => sent.length).toBe(5);
      expect(sent[4]).toEqual({
        origin: apiOrigin,
        body: expect.objectContaining({ captchaToken: 'test-token' })
      });
      await expect(page.getByRole('main')).toContainText(
        'User with this email already exists.'
      );
    }
  });
});
