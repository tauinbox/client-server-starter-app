import { expect, loginViaUi, test } from '../fixtures/base.fixture';
import { createMockUser } from '../fixtures/mock-data';
import { mockId } from '../fixtures/ids';

const PASSWORD = 'Lantern-Orchard-47';
const TARGET_ID = mockId('user-3');
const TARGET_EMAIL = 'john@example.com';

const target = createMockUser({
  id: TARGET_ID,
  email: TARGET_EMAIL,
  firstName: 'John',
  lastName: 'Smith',
  password: PASSWORD,
  roles: ['user'],
  isActive: true,
  isEmailVerified: true
});

// The session of the target lives outside the browser, so the test proves the
// click reached the server and ended it, not only that a message appeared.
async function signInTarget(mockServerUrl: string): Promise<string> {
  const res = await fetch(`${mockServerUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: TARGET_EMAIL, password: PASSWORD })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function profileStatus(
  mockServerUrl: string,
  token: string
): Promise<number> {
  const res = await fetch(`${mockServerUrl}/api/v1/auth/profile`, {
    headers: { authorization: `Bearer ${token}` }
  });
  return res.status;
}

test.describe('Sign out everywhere by an administrator', () => {
  test('ends every session of the user after the confirmation', async ({
    _mockServer,
    page
  }) => {
    await _mockServer.seedUsers([target]);
    const token = await signInTarget(_mockServer.url);
    expect(await profileStatus(_mockServer.url, token)).toBe(200);

    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto(`/users/${TARGET_ID}/edit`);
    await page.getByRole('button', { name: 'Sign out everywhere' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('John Smith')).toBeVisible();
    await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();

    await expect(
      page.getByText('Every session of the user has ended')
    ).toBeVisible();
    expect(await profileStatus(_mockServer.url, token)).toBe(401);
    await expect(page).toHaveURL(new RegExp(`/users/${TARGET_ID}/edit`));
  });

  test('keeps the sessions when the confirmation is cancelled', async ({
    _mockServer,
    page
  }) => {
    await _mockServer.seedUsers([target]);
    const token = await signInTarget(_mockServer.url);

    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto(`/users/${TARGET_ID}/edit`);
    await page.getByRole('button', { name: 'Sign out everywhere' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel' })
      .click();

    await expect(page.getByRole('dialog')).toBeHidden();
    expect(await profileStatus(_mockServer.url, token)).toBe(200);
  });
});
