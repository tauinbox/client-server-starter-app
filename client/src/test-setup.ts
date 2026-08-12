Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => false
  })
});

/**
 * The test DOM has no IntersectionObserver, and every list page now mounts
 * `nxsInfiniteScroll`, which constructs one. A no-op stub keeps the observer
 * from firing on its own; specs that need to drive it (e.g. asserting a page
 * is requested when the sentinel scrolls into view) stub it themselves with
 * `vi.stubGlobal`, which takes precedence.
 */
class NoopIntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {
    // Intentionally inert: the sentinel never reports an intersection in tests.
  }
  unobserve(): void {
    // Intentionally inert.
  }
  disconnect(): void {
    // Intentionally inert.
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: NoopIntersectionObserver
});
Object.defineProperty(globalThis, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: NoopIntersectionObserver
});
