import { expect, loginViaUi, test } from '../fixtures/base.fixture';
import type { Page } from '@playwright/test';

// Visual regression spec for the M3 button-color migration (BKL-018).
//
// What it protects against: the silent no-op behaviour of the legacy M2
// `color="primary|accent|warn"` attribute under the M3 theme. The static lint
// rule (`lint:no-mat-color`) prevents the attribute itself from re-entering
// the codebase. This spec catches the inverse failure mode — someone removes
// the replacement utility class (`app-btn-danger`, `app-chip-danger`) and the
// element silently falls back to the neutral default tone.
//
// We assert the resolved computed colour against the system token directly
// (`--mat-sys-error`), so the test stays valid across palette/theme tweaks.
// Both light and dark themes are exercised.

const seedTheme = (page: Page, theme: 'light' | 'dark'): Promise<void> =>
  page.addInitScript((t) => {
    localStorage.setItem('preferred-theme', t);
  }, theme);

// Resolve a CSS custom property to its canonical `rgb(r, g, b)` form via a
// throw-away probe element. `getPropertyValue('--mat-sys-error')` returns the
// raw token string (often `#ffb4ab`), while `getPropertyValue('color')`
// always returns `rgb(...)`. Comparing through a probe normalises both sides.
const resolveTokenColor = async (
  page: Page,
  tokenName: string
): Promise<string> =>
  page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    document.body.removeChild(probe);
    return resolved;
  }, tokenName);

const computedProp = async (
  page: Page,
  selector: string,
  prop: 'color' | 'background-color' | 'border-color'
): Promise<string> =>
  page.evaluate(
    ({ s, p }) => {
      const el = document.querySelector(s) as HTMLElement | null;
      if (!el) throw new Error(`Selector not found: ${s}`);
      return getComputedStyle(el).getPropertyValue(p).trim();
    },
    { s: selector, p: prop }
  );

// Browsers normalise colour values to `rgb(r, g, b)` form. Strip whitespace
// so the comparison is format-agnostic.
const normalise = (raw: string): string => raw.replace(/\s+/g, '');

for (const theme of ['light', 'dark'] as const) {
  test.describe(`M3 destructive utilities — ${theme} theme`, () => {
    test(`user-edit delete button reads --mat-sys-error in ${theme} mode`, async ({
      _mockServer,
      page
    }) => {
      await seedTheme(page, theme);

      await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
      await page.goto('/users/3/edit');
      await expect(
        page.getByRole('button', { name: 'Delete', exact: true })
      ).toBeVisible();

      const errorToken = await resolveTokenColor(page, '--mat-sys-error');
      expect(errorToken).toMatch(/^rgba?\(/);

      // The delete button is a `matButton="text"` — the destructive tone is
      // applied through `--mat-button-text-label-text-color` on the host,
      // so the resolved `color` of the button matches `--mat-sys-error`.
      const buttonColor = await computedProp(
        page,
        'button.app-btn-danger',
        'color'
      );
      expect(normalise(buttonColor)).toBe(normalise(errorToken));
    });

    test(`forbidden DOM has no legacy color="primary|accent|warn" in ${theme} mode`, async ({
      _mockServer,
      page
    }) => {
      await seedTheme(page, theme);

      await loginViaUi(page, _mockServer.url, { roles: ['user'] });
      await page.goto('/forbidden');

      // Defence-in-depth: lint:no-mat-color bans the source attribute, but
      // a live DOM check catches any binding that could re-introduce it
      // dynamically (e.g. a future `[attr.color]="..."` regression).
      const legacyAttrs = await page.evaluate(
        () =>
          document.querySelectorAll(
            '[color="primary"], [color="accent"], [color="warn"]'
          ).length
      );
      expect(legacyAttrs).toBe(0);
    });
  });
}
