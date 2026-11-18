import type { Page, Request } from '@playwright/test';

type TrackedRequest = {
  page: Page;
  method: string;
  path: string;
  sentAt: number;
  routedAt: number | null;
};

export type PendingRequestReport = {
  method: string;
  path: string;
  ageMs: number;
  // False when the mock-server route handler never ran for the request: the
  // browser sent it, but the driver did not deliver it to the handler. A route
  // of the test itself that takes priority and never answers also gives false.
  routeHandlerRan: boolean;
  routeDelayMs: number | null;
  reachedMockServer: boolean;
  pageUrl: string;
  // True when the page has loaded a new document since it sent the request:
  // the request belonged to the old document and is not a stall. Playwright
  // fires neither `requestfinished` nor `requestfailed` for a routed request
  // that a navigation cancels, so such requests stay listed.
  documentStartedAfterRequest: boolean | null;
};

const tracked = new Map<Request, TrackedRequest>();
const arrivals: { path: string; at: number }[] = [];

export function resetRequestTracking(): void {
  tracked.clear();
  arrivals.length = 0;
}

function pathOf(url: string): string {
  const { pathname, search } = new URL(url);

  return pathname + search;
}

// The order of the `request` event and the route handler is not documented,
// so each of the two creates the entry when the other has not.
function entryOf(page: Page, request: Request): TrackedRequest {
  const existing = tracked.get(request);

  if (existing) {
    return existing;
  }

  const entry = {
    page,
    method: request.method(),
    path: pathOf(request.url()),
    sentAt: Date.now(),
    routedAt: null
  };

  tracked.set(request, entry);

  return entry;
}

export function trackSentRequest(page: Page, request: Request): void {
  entryOf(page, request);
}

export function trackRoutedRequest(page: Page, request: Request): void {
  entryOf(page, request).routedAt = Date.now();
}

export function untrackRequest(request: Request): void {
  tracked.delete(request);
}

export function recordMockServerArrival(path: string): void {
  arrivals.push({ path, at: Date.now() });
}

/**
 * Lists the `/api` requests that got no response. Attach it to a failed test:
 * a request that the route handler never got, or that never reached the mock
 * server, on a page whose document is older than the request, is a lost
 * request.
 */
export async function pendingRequestReport(): Promise<PendingRequestReport[]> {
  const now = Date.now();

  return Promise.all(
    [...tracked.values()].map(async (entry) => {
      const documentStart = entry.page.isClosed()
        ? null
        : await entry.page
            .evaluate(() => performance.timeOrigin)
            .catch(() => null);

      return {
        method: entry.method,
        path: entry.path,
        ageMs: now - entry.sentAt,
        routeHandlerRan: entry.routedAt !== null,
        routeDelayMs:
          entry.routedAt === null ? null : entry.routedAt - entry.sentAt,
        reachedMockServer: arrivals.some(
          (arrival) => arrival.path === entry.path && arrival.at >= entry.sentAt
        ),
        pageUrl: entry.page.isClosed() ? 'closed' : entry.page.url(),
        documentStartedAfterRequest:
          documentStart === null ? null : documentStart > entry.sentAt
      };
    })
  );
}
