import { TestBed } from '@angular/core/testing';
import { signalStore } from '@ngrx/signals';
import { withListFilters } from './with-list-filters';

type TestQuery = { q?: string; enabled?: boolean; ids?: string[] };

const TestStore = signalStore(
  { providedIn: 'root' },
  withListFilters<TestQuery>({})
);

describe('withListFilters', () => {
  it('starts from the initial filters with none active', () => {
    const store = TestBed.inject(TestStore);

    expect(store.filters()).toEqual({});
    expect(store.hasActiveFilters()).toBe(false);
  });

  it('replaces the filters and reports a false boolean as active', () => {
    const store = TestBed.inject(TestStore);

    store.setFilters({ enabled: false });

    expect(store.filters()).toEqual({ enabled: false });
    expect(store.hasActiveFilters()).toBe(true);
  });

  it('reports an empty search and an empty id list as inactive', () => {
    const store = TestBed.inject(TestStore);

    store.setFilters({ q: '', ids: [], enabled: undefined });

    expect(store.hasActiveFilters()).toBe(false);
  });
});
