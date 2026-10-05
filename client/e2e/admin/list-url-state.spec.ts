import {
  chooseOption,
  expect,
  listResponse,
  loginViaUi,
  test
} from '../fixtures/base.fixture';

// The filters and the sort of a list live in the URL: a reload, a copied link,
// Back and Forward all open the same list, and the cursor is never in it.

const FLAGS_API = '/api/v1/admin/feature-flags/cursor';
const ROLES_API = '/api/v1/roles/cursor';

test.describe('List state in the URL', () => {
  test.beforeEach(async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
  });

  test('a filtered list survives a reload, and Back undoes one select', async ({
    page
  }) => {
    await page.goto('/admin/feature-flags');
    await expect(page.getByText('new-dashboard')).toBeVisible();

    const searched = listResponse(page, FLAGS_API, { q: 'dashboard' });
    await page.getByLabel('Search').fill('dashboard');
    await searched;
    const disabled = listResponse(page, FLAGS_API, {
      q: 'dashboard',
      enabled: 'false'
    });
    await chooseOption(page, 'Status', 'Disabled');
    await disabled;
    await expect(page).toHaveURL(
      /\/admin\/feature-flags\?flags\.q=dashboard&flags\.enabled=false$/
    );

    const reloaded = listResponse(page, FLAGS_API, {
      q: 'dashboard',
      enabled: 'false'
    });
    await page.reload();
    await reloaded;
    await expect(page.getByLabel('Search')).toHaveValue('dashboard');
    await expect(page.getByText('beta-export')).toBeHidden();

    // The search was typed without a history entry, the select made one.
    const back = listResponse(page, FLAGS_API, { q: 'dashboard' });
    await page.goBack();
    const response = await back;
    expect(new URL(response.url()).searchParams.has('enabled')).toBe(false);
    await expect(page).toHaveURL(/\?flags\.q=dashboard$/);
    await expect(page.getByLabel('Search')).toHaveValue('dashboard');
  });

  test('a link opens the same list; junk params are dropped, not sent', async ({
    page
  }) => {
    const opened = listResponse(page, ROLES_API, {
      isSystem: 'false',
      sortBy: 'name',
      sortOrder: 'asc'
    });
    await page.goto(
      '/admin/roles?roles.isSystem=false&roles.sortBy=name&roles.sortOrder=asc' +
        '&roles.q=a&roles.q=b&roles.junk=1&roles.limit=500&returnUrl=%2Fx'
    );
    const response = await opened;
    expect(response.status()).toBe(200);
    expect(new URL(response.url()).searchParams.has('q')).toBe(false);
    // The page size is the client's own; the URL cannot set it.
    expect(new URL(response.url()).searchParams.get('limit')).toBe('20');

    await expect(
      page.getByRole('cell', { name: 'editor', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'admin', exact: true })
    ).toBeHidden();
    // Canonical list params; a param of the app is left alone.
    await expect(page).toHaveURL(
      /\/admin\/roles\?roles\.isSystem=false&roles\.sortBy=name&roles\.sortOrder=asc&returnUrl=%2Fx$/
    );
  });

  test('a column header writes the sort, and the next page keeps it', async ({
    page
  }) => {
    await page.goto('/admin/roles');
    await expect(
      page.getByRole('cell', { name: 'editor', exact: true })
    ).toBeVisible();

    const sorted = listResponse(page, ROLES_API, {
      sortBy: 'name',
      sortOrder: 'asc'
    });
    await page.getByRole('columnheader', { name: 'Name' }).click();
    await sorted;
    await expect(page).toHaveURL(/\?roles\.sortBy=name&roles\.sortOrder=asc$/);
    await expect(
      page.getByRole('columnheader', { name: 'Name' })
    ).toHaveAttribute('aria-sort', 'ascending');
  });

  test('a tab switch leaves the params of the old list behind', async ({
    page
  }) => {
    await page.goto('/admin/feature-flags?flags.enabled=false');
    await expect(page.getByText('new-dashboard')).toBeVisible();

    await page.getByRole('tab', { name: 'Roles' }).click();
    await expect(page).toHaveURL(/\/admin\/roles$/);

    // The URL wins: back on the tab, an empty URL means no filters.
    const unfiltered = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith(FLAGS_API) &&
        !new URL(r.url()).searchParams.has('enabled')
    );
    await page.getByRole('tab', { name: 'Feature Flags' }).click();
    await unfiltered;
    await expect(page).toHaveURL(/\/admin\/feature-flags$/);
  });

  test('the list params come back after a sign-in through returnUrl', async ({
    page,
    context
  }) => {
    await context.clearCookies();
    await page.goto('/admin/feature-flags?flags.q=a%26b%20%23c');
    await expect(page).toHaveURL(/\/login\?returnUrl=/);

    await page.getByLabel('Email').fill('testlogin@example.com');
    await page.getByLabel('Password', { exact: true }).fill('Password1');
    const searched = listResponse(page, FLAGS_API, { q: 'a&b #c' });
    await page.getByRole('main').getByRole('button', { name: 'Login' }).click();
    await searched;

    await expect(page.getByLabel('Search')).toHaveValue('a&b #c');
  });
});
