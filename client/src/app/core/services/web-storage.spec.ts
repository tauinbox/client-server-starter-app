import { TestBed } from '@angular/core/testing';

import { LocalStorageService } from './local-storage.service';
import { SessionStorageService } from './session-storage.service';

const KEY = 'web-storage-spec';

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

describe('web-storage', () => {
  let local: LocalStorageService;
  let session: SessionStorageService;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.configureTestingModule({});
    local = TestBed.inject(LocalStorageService);
    session = TestBed.inject(SessionStorageService);
  });

  it('returns null for a missing key', () => {
    expect(local.getItem(KEY)).toBeNull();
  });

  it('round-trips a JSON value', () => {
    local.setItem(KEY, { a: 1 });
    expect(local.getItem(KEY)).toEqual({ a: 1 });
  });

  it('round-trips a plain string stored unquoted', () => {
    local.setItem(KEY, 'dark');
    expect(localStorage.getItem(KEY)).toBe('dark');
    expect(local.getItem(KEY)).toBe('dark');
  });

  it('returns null when the guard rejects the stored value', () => {
    localStorage.setItem(KEY, 'not-a-number');
    expect(local.getItem(KEY, isCount)).toBeNull();
  });

  it('returns the value when the guard accepts it', () => {
    local.setItem(KEY, 3);
    expect(local.getItem(KEY, isCount)).toBe(3);
  });

  it('applies the same semantics to session storage', () => {
    sessionStorage.setItem(KEY, 'not-a-number');
    expect(session.getItem(KEY, isCount)).toBeNull();
    expect(session.getItem(KEY)).toBe('not-a-number');
  });

  it('removes a stored value', () => {
    local.setItem(KEY, 'x');
    local.removeItem(KEY);
    expect(local.getItem(KEY)).toBeNull();
  });
});
