import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
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
    getAll: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    toggle: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    replaceRules: ReturnType<typeof vi.fn>;
  };
  let notify: {
    error: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      getAll: vi.fn().mockReturnValue(of([sampleFlag()])),
      create: vi.fn(),
      update: vi.fn(),
      toggle: vi.fn(),
      delete: vi.fn(),
      replaceRules: vi.fn()
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

  it('load() populates entities and clears loading', () => {
    const store = TestBed.inject(FeatureFlagsAdminStore);
    store.load();
    expect(store.entities().length).toBe(1);
    expect(store.entities()[0].key).toBe('new-dashboard');
    expect(store.loading()).toBe(false);
  });

  it('load() surfaces an error and notifies on failure', () => {
    service.getAll.mockReturnValue(throwError(() => new Error('boom')));
    const store = TestBed.inject(FeatureFlagsAdminStore);
    store.load();
    expect(store.error()).toBeTruthy();
    expect(notify.error).toHaveBeenCalledWith(
      'admin.featureFlags.errorLoadFailed'
    );
  });

  it('updateFlag() pushes the new entity into the store on 200', async () => {
    const updated = sampleFlag({ enabled: true, version: 2 });
    service.update.mockReturnValue(of(updated));
    const store = TestBed.inject(FeatureFlagsAdminStore);
    store.load();
    const result = await firstValueFrom(
      store.updateFlag('flag-1', { enabled: true }, 1)
    );
    expect(result.version).toBe(2);
    expect(store.entities()[0].enabled).toBe(true);
    expect(service.update).toHaveBeenCalledWith('flag-1', { enabled: true }, 1);
  });

  it('updateFlag() propagates a 409 version-conflict error to the caller', async () => {
    const conflict = new HttpErrorResponse({
      status: 409,
      error: {
        message: 'Feature flag was modified by another request',
        errorKey: 'errors.featureFlags.versionConflict'
      }
    });
    service.update.mockReturnValue(throwError(() => conflict));
    const store = TestBed.inject(FeatureFlagsAdminStore);
    store.load();
    await expect(
      firstValueFrom(store.updateFlag('flag-1', { enabled: true }, 1))
    ).rejects.toBe(conflict);
  });

  it('toggleFlag() updates the entity locally', async () => {
    service.toggle.mockReturnValue(
      of(sampleFlag({ enabled: true, version: 2 }))
    );
    const store = TestBed.inject(FeatureFlagsAdminStore);
    store.load();
    await firstValueFrom(store.toggleFlag('flag-1'));
    expect(store.entities()[0].enabled).toBe(true);
  });

  it('deleteFlag() removes the entity from the store', async () => {
    service.delete.mockReturnValue(of(undefined));
    const store = TestBed.inject(FeatureFlagsAdminStore);
    store.load();
    await firstValueFrom(store.deleteFlag('flag-1'));
    expect(store.entities().length).toBe(0);
  });
});
