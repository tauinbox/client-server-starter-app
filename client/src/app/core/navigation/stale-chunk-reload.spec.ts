import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationError } from '@angular/router';
import { isChunkLoadFailure, reloadOnStaleChunk } from './stale-chunk-reload';

const CHROMIUM = new TypeError(
  'Failed to fetch dynamically imported module: https://example.com/chunk-60koVSsJ.js'
);
const FIREFOX = new TypeError(
  'error loading dynamically imported module: https://example.com/chunk-60koVSsJ.js'
);
const SAFARI = new TypeError('Importing a module script failed.');

describe('reloadOnStaleChunk', () => {
  let assign: ReturnType<typeof vi.fn<(url: string) => void>>;

  beforeEach(() => {
    sessionStorage.clear();
    assign = vi.fn<(url: string) => void>();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DOCUMENT,
          useValue: { defaultView: { location: { assign }, sessionStorage } }
        }
      ]
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  function fail(url: string, error: unknown): void {
    TestBed.runInInjectionContext(() =>
      reloadOnStaleChunk(new NavigationError(1, url, error))
    );
  }

  it('recognises the chunk failure of each browser and nothing else', () => {
    expect(isChunkLoadFailure(CHROMIUM)).toBe(true);
    expect(isChunkLoadFailure(FIREFOX)).toBe(true);
    expect(isChunkLoadFailure(SAFARI)).toBe(true);
    expect(isChunkLoadFailure(new Error('Cannot match any routes'))).toBe(
      false
    );
    expect(
      isChunkLoadFailure('Failed to fetch dynamically imported module')
    ).toBe(false);
  });

  it('loads the target URL in full when a lazy chunk of the old build is gone', () => {
    fail('/admin/users', CHROMIUM);

    expect(assign).toHaveBeenCalledExactlyOnceWith('/admin/users');
  });

  it('leaves any other navigation error to the router', () => {
    fail('/admin/users', new Error('Cannot match any routes'));

    expect(assign).not.toHaveBeenCalled();
  });

  it('never loads a URL outside the app origin', () => {
    fail('//evil.example.com/profile', CHROMIUM);
    fail('https://evil.example.com/profile', CHROMIUM);

    expect(assign).not.toHaveBeenCalled();
  });

  it('does not reload a second time when the fresh build fails on the same URL', () => {
    fail('/admin/users', CHROMIUM);
    fail('/admin/users', CHROMIUM);

    expect(assign).toHaveBeenCalledOnce();
  });

  it('reloads again for another URL, or for the same URL after the window', () => {
    vi.useFakeTimers();
    fail('/admin/users', CHROMIUM);
    fail('/profile', CHROMIUM);
    vi.advanceTimersByTime(10_000);
    fail('/profile', CHROMIUM);

    expect(assign.mock.calls).toEqual([
      ['/admin/users'],
      ['/profile'],
      ['/profile']
    ]);
  });
});
