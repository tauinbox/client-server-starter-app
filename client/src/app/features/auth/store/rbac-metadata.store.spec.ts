import { TestBed } from '@angular/core/testing';
import { RbacMetadataStore } from './rbac-metadata.store';
import type { ActionResponse, ResourceResponse } from '@app/shared/types';

const RBAC_CACHE_KEY = 'rbac_metadata';

function createResource(): ResourceResponse {
  return {
    id: 'res-1',
    name: 'users',
    subject: 'User',
    displayName: 'Users',
    description: null,
    isSystem: true,
    isOrphaned: false,
    isRegistered: true,
    allowedActionNames: null,
    createdAt: '2024-01-01T00:00:00.000Z'
  };
}

function createAction(): ActionResponse {
  return {
    id: 'act-1',
    name: 'read',
    displayName: 'Read',
    description: 'Read access',
    isDefault: true,
    createdAt: '2024-01-01T00:00:00.000Z'
  };
}

function createStore() {
  TestBed.configureTestingModule({});
  return TestBed.inject(RbacMetadataStore);
}

describe('RbacMetadataStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('should restore a well-formed cache', () => {
    const resource = createResource();
    const action = createAction();
    localStorage.setItem(
      RBAC_CACHE_KEY,
      JSON.stringify({ resources: [resource], actions: [action] })
    );

    const store = createStore();

    expect(store.resources()).toEqual([resource]);
    expect(store.actions()).toEqual([action]);
    expect(store.subjectMap()).toEqual({ users: 'User' });
    // The cache never counts as loaded - the metadata is always refetched.
    expect(store.loaded()).toBe(false);
  });

  it('should ignore a cache whose resources is not an array', () => {
    localStorage.setItem(
      RBAC_CACHE_KEY,
      JSON.stringify({ resources: 'nope', actions: [] })
    );

    const store = createStore();

    expect(store.resources()).toEqual([]);
    expect(store.subjectMap()).toEqual({});
  });

  it('should ignore a cache whose resources hold the wrong shape', () => {
    localStorage.setItem(
      RBAC_CACHE_KEY,
      JSON.stringify({ resources: [{ name: 'users' }], actions: [] })
    );

    const store = createStore();

    expect(store.resources()).toEqual([]);
    expect(store.subjectMap()).toEqual({});
  });

  it('should ignore a cache that is not an object', () => {
    localStorage.setItem(RBAC_CACHE_KEY, JSON.stringify(['users']));

    const store = createStore();

    expect(store.resources()).toEqual([]);
    expect(store.actions()).toEqual([]);
  });
});
