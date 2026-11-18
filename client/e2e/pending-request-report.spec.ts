import { expect, test } from './fixtures/base.fixture';
import { pendingRequestReport } from './fixtures/pending-requests';

const heldPath = '/api/v1/held-request';

test.describe('Pending API request report', () => {
  test('lists a request that the mock-server route handler never got', async ({
    _mockServer,
    page
  }) => {
    // A newer route takes priority, and this one never answers, so the
    // request stays sent but never reaches the mock-server route handler.
    await page.route(heldPath, () => undefined);
    await page.goto('/login');
    await page.evaluate((path) => {
      void fetch(path);
    }, heldPath);

    await expect
      .poll(async () =>
        (await pendingRequestReport()).filter(({ path }) => path === heldPath)
      )
      .toEqual([
        expect.objectContaining({
          method: 'GET',
          routeHandlerRan: false,
          routeDelayMs: null,
          reachedMockServer: false,
          documentStartedAfterRequest: false
        })
      ]);
  });

  test('drops a request that got its response', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/login');
    const status = await page.evaluate(async () => {
      const response = await fetch('/api/v1/feature-flags');

      await response.text();

      return response.status;
    });

    expect(status).toBe(200);
    // `requestfinished` reaches the worker after the page has the body.
    await expect
      .poll(async () =>
        (await pendingRequestReport()).filter(
          ({ path }) => path === '/api/v1/feature-flags'
        )
      )
      .toEqual([]);
  });
});
