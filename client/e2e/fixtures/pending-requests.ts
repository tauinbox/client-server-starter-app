import type { Page, Request } from '@playwright/test';

type RoutedRequest = {
  page: Page;
  method: string;
  path: string;
  routedAt: number;
};

export type PendingRequestReport = {
  method: string;
  path: string;
  ageMs: number;
  reachedMockServer: boolean;
  pageUrl: string;
  // True when the page has loaded a new document since the request was
  // routed: the request belonged to the old document and is not a stall.
  // Playwright fires neither `requestfinished` nor `requestfailed` for a
  // routed request that a navigation cancels, so such requests stay listed.
  // False does not prove a stall: the route handler runs up to a few hundred
  // milliseconds after the browser sends the request.
  documentStartedAfterRouting: boolean | null;
};

const routed = new Map<Request, RoutedRequest>();
const arrivals: { path: string; at: number }[] = [];

export function resetRequestTracking(): void {
  routed.clear();
  arrivals.length = 0;
}

export function trackRoutedRequest(
  page: Page,
  request: Request,
  url: string
): void {
  const { pathname, search } = new URL(url);
  routed.set(request, {
    page,
    method: request.method(),
    path: pathname + search,
    routedAt: Date.now()
  });
}

export function untrackRequest(request: Request): void {
  routed.delete(request);
}

export function recordMockServerArrival(path: string): void {
  arrivals.push({ path, at: Date.now() });
}

/**
 * Lists the routed `/api` requests that got no response. Attach it to a failed
 * test: a request that never reached the mock server, on a page whose document
 * is older than the request, is a request lost between the route handler and
 * the mock server.
 */
export async function pendingRequestReport(): Promise<PendingRequestReport[]> {
  const now = Date.now();
  return Promise.all(
    [...routed.values()].map(async (entry) => {
      const documentStart = entry.page.isClosed()
        ? null
        : await entry.page
            .evaluate(() => performance.timeOrigin)
            .catch(() => null);
      return {
        method: entry.method,
        path: entry.path,
        ageMs: now - entry.routedAt,
        reachedMockServer: arrivals.some(
          (arrival) =>
            arrival.path === entry.path && arrival.at >= entry.routedAt
        ),
        pageUrl: entry.page.isClosed() ? 'closed' : entry.page.url(),
        documentStartedAfterRouting:
          documentStart === null ? null : documentStart > entry.routedAt
      };
    })
  );
}
