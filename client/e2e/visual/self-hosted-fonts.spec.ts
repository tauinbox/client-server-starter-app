import { expect, loginViaUi, test } from '../fixtures/base.fixture';

// The fonts come from the bundle. A page that waits for a third-party font
// host never reports `load` when that host does not answer, and its icons
// show their ligature names as text.

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

test('fonts load from the bundle and icons render as glyphs', async ({
  _mockServer,
  page
}) => {
  const fontHostRequests: string[] = [];
  page.on('request', (request) => {
    if (FONT_HOSTS.includes(new URL(request.url()).hostname)) {
      fontHostRequests.push(request.url());
    }
  });

  await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
  await page.goto('/users');
  await expect(page.locator('table')).toBeVisible();

  const faces = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts]
      .filter((face) => face.status === 'loaded')
      .map((face) => face.family.replace(/"/g, ''));
  });
  expect(faces).toContain('Roboto');
  expect(faces).toContain('Material Icons');

  // A ligature that renders as text is several times wider than one glyph.
  const iconWidth = await page.evaluate(() => {
    const icon = document.createElement('span');
    icon.className = 'material-icons';
    icon.textContent = 'account_circle';
    document.body.appendChild(icon);
    const width = icon.getBoundingClientRect().width;
    icon.remove();
    return width;
  });
  expect(iconWidth).toBe(24);

  expect(fontHostRequests).toEqual([]);
});
