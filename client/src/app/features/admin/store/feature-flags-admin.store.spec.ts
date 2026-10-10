import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { storeOverrideWarnings } from '../../../../test-utils/store-override-warnings';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';
import { NotifyService } from '@core/services/notify.service';
import { FeatureFlagsAdminStore } from './feature-flags-admin.store';
import { FeatureFlagsAdminService } from '../services/feature-flags-admin.service';
import type { FeatureFlagResponse } from '@app/shared/types';

const sampleFlag = (
  overrides: Partial<FeatureFlagResponse> = {}
): FeatureFlagResponse => ({
  id: 'flag-1',
  key: 'new-dashboard',
  description: null,
  enabled: false,
  environments: [],
  public: false,
  version: 1,
  updatedByUserId: null,
  createdAt: '2026-05-19T10:00:00Z',
  updatedAt: '2026-05-19T10:00:00Z',
  rules: [],
  ...overrides
});

describe('FeatureFlagsAdminStore', () => {
  let service: {
    getAllCursor: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    getOne: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let notify: {
    error: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      getAllCursor: vi.fn().mockReturnValue(
        of({
          data: [sampleFlag()],
          meta: { nextCursor: null, hasMore: false, limit: 20 }
        })
      ),
      create: vi.fn(),
      update: vi.fn(),
      getOne: vi.fn(),
      delete: vi.fn()
    };
    notify = { error: vi.fn(), success: vi.fn() };

    TestBed.configureTestingModule({
      imports: [TranslocoTestingModuleWithLangs],
      providers: [
        FeatureFlagsAdminStore,
        { provide: FeatureFlagsAdminService, useValue: service },
        { provide: NotifyService, useValue: notify }
      ]
    });
  });

  it('declares each store member once', () => {
    expect(
      storeOverrideWarnings(() => TestBed.inject(FeatureFlagsAdminStore))
    ).toEqual([]);
  });

  it('load() populates entities and clears loading', async () => {
    const store = TestBed.inject(FeatureFlagsAdminStore);
    store.load();
    await vi.waitFor(() => expect(store.loading()).toBe(false));

    expect(store.entities().length).toBe(1);
    expect(store.entities()[0].key).toBe('new-dashboard');
    expect(service.getAllCursor).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: null }),
      {}
    );
  });

  it('load() sends the filters set before it', async () => {
    const store = TestBed.inject(FeatureFlagsAdminStore);
    store.setFilters({ q: 'beta', enabled: false });
    store.load();
    await vi.waitFor(() => expect(store.loading()).toBe(false));

    expect(service.getAllCursor).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: null }),
      { q: 'beta', enabled: false }
    );
    expect(store.hasActiveFilters()).toBe(true);
  });

  it('load() notifies on failure and leaves the list empty', async () => {
    service.getAllCursor.mockReturnValue(throwError(() => new Error('boom')));
    const store = TestBed.inject(FeatureFlagsAdminStore);
    store.load();
    await vi.waitFor(() => expect(store.loading()).toBe(false));

    expect(store.entities()).toEqual([]);
    expect(notify.error).toHaveBeenCalledWith(
      expect.anything(),
      'admin.featureFlags.errorLoadFailed'
    );
  });

  it('updateFlag() pushes the new entity into the store on 200', async () => {
    const updated = sampleFlag({ enabled: true, version: 2 });
    service.update.mockReturnValue(of(updated));
    const store = TestBed.inject(FeatureFlagsAdminStore);
    store.load();
    await vi.waitFor(() => expect(store.entities().length).toBe(1));
    const result = await firstValueFrom(
      store.updateFlag('flag-1', { enabled: true }, 1)
    );
    expect(result.version).toBe(2);
    expect(store.entities()[0].enabled).toBe(true);
    expect(service.update).toHaveBeenCalledWith('flag-1', { enabled: true }, 1);
  });

  describe('updateFlag() on a version conflict', () => {
    const conflict = new HttpErrorResponse({
      status: 409,
      error: {
        message: 'Feature flag was modified by another request',
        errorKey: 'errors.featureFlags.versionConflict'
      }
    });

    async function loadedStore() {
      const store = TestBed.inject(FeatureFlagsAdminStore);
      store.load();
      await vi.waitFor(() => expect(store.entities().length).toBe(1));
      return store;
    }

    it('replaces the entity with the stored row and rethrows the conflict', async () => {
      service.update.mockReturnValue(throwError(() => conflict));
      service.getOne.mockReturnValue(
        of(sampleFlag({ description: 'by another admin', version: 2 }))
      );
      const store = await loadedStore();

      await expect(
        firstValueFrom(store.updateFlag('flag-1', { enabled: true }, 1))
      ).rejects.toBe(conflict);
      expect(service.getOne).toHaveBeenCalledWith('flag-1');
      expect(store.entities()[0]).toMatchObject({
        description: 'by another admin',
        version: 2
      });
    });

    it('rethrows the conflict when the reload fails', async () => {
      service.update.mockReturnValue(throwError(() => conflict));
      service.getOne.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 500 }))
      );
      const store = await loadedStore();

      await expect(
        firstValueFrom(store.updateFlag('flag-1', { enabled: true }, 1))
      ).rejects.toBe(conflict);
      expect(store.entities()[0].version).toBe(1);
    });

    it('does not reload the row after another error', async () => {
      const error = new HttpErrorResponse({ status: 500 });
      service.update.mockReturnValue(throwError(() => error));
      const store = await loadedStore();

      await expect(
        firstValueFrom(store.updateFlag('flag-1', { enabled: true }, 1))
      ).rejects.toBe(error);
      expect(service.getOne).not.toHaveBeenCalled();
    });
  });

  it('deleteFlag() removes the entity from the store', async () => {
    service.delete.mockReturnValue(of(undefined));
    const store = TestBed.inject(FeatureFlagsAdminStore);
    store.load();
    await vi.waitFor(() => expect(store.entities().length).toBe(1));
    await firstValueFrom(store.deleteFlag('flag-1'));
    expect(store.entities().length).toBe(0);
  });
});
