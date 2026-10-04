import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { TranslocoTestingModuleWithLangs } from '../../../../../../test-utils/transloco-testing';
import { LayoutService } from '@core/services/layout.service';
import { NotifyService } from '@core/services/notify.service';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { FeatureFlagsAdminStore } from '../../../store/feature-flags-admin.store';
import { FeatureFlagsAdminService } from '../../../services/feature-flags-admin.service';
import type { FeatureFlagFormDialogResult } from '../feature-flag-form-dialog/feature-flag-form-dialog.component';
import { FeatureFlagListComponent } from './feature-flag-list.component';

describe('FeatureFlagListComponent', () => {
  const flag = {
    id: 'flag-1',
    key: 'new-dashboard',
    description: 'rollout',
    enabled: false,
    environments: ['production'],
    public: false,
    version: 1,
    updatedByUserId: null,
    createdAt: '2026-05-19T10:00:00Z',
    updatedAt: '2026-05-19T10:00:00Z',
    rules: []
  };

  let toggleSpy: ReturnType<typeof vi.fn>;
  let confirmSpy: ReturnType<typeof vi.fn>;
  let layoutHandset: ReturnType<typeof signal<boolean>>;
  let notifySuccess: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let serviceMock: {
    getAll: ReturnType<typeof vi.fn>;
    getAllCursor: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    toggle: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    toggleSpy = vi
      .fn()
      .mockReturnValue(of({ ...flag, enabled: true, version: 2 }));
    confirmSpy = vi.fn().mockReturnValue(of(true));
    layoutHandset = signal(false);
    notifySuccess = vi.fn();
    notifyError = vi.fn();

    serviceMock = {
      getAll: vi.fn().mockReturnValue(of([flag])),
      getAllCursor: vi.fn().mockReturnValue(
        of({
          data: [flag],
          meta: { nextCursor: null, hasMore: false, limit: 20 }
        })
      ),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      toggle: toggleSpy
    };

    dialogOpen = vi.fn();

    await TestBed.configureTestingModule({
      imports: [FeatureFlagListComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        FeatureFlagsAdminStore,
        { provide: FeatureFlagsAdminService, useValue: serviceMock },
        {
          provide: NotifyService,
          useValue: { success: notifySuccess, error: notifyError }
        },
        {
          provide: AdaptiveDialogService,
          useValue: { openConfirm: confirmSpy }
        },
        {
          provide: MatDialog,
          useValue: { open: dialogOpen }
        },
        {
          provide: LayoutService,
          useValue: {
            isHandset: layoutHandset,
            isTablet: signal(false),
            isWeb: signal(true)
          }
        },
        {
          provide: AuthStore,
          useValue: { hasPermissions: vi.fn().mockReturnValue(true) }
        }
      ]
    })
      .overrideComponent(FeatureFlagListComponent, {
        set: { providers: [] }
      })
      .compileComponents();
  });

  function stubDialogResult(result: FeatureFlagFormDialogResult): void {
    dialogOpen.mockReturnValue({ afterClosed: () => of(result) });
  }

  it('renders the desktop table with one row per flag', async () => {
    const fixture = TestBed.createComponent(FeatureFlagListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'table tbody tr'
    );
    expect(rows.length).toBe(1);
    expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain(
      'new-dashboard'
    );
  });

  it('switches to a card list on handset', async () => {
    layoutHandset.set(true);
    const fixture = TestBed.createComponent(FeatureFlagListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const cards = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.flag-card'
    );
    expect(cards.length).toBe(1);
    const fab = (fixture.nativeElement as HTMLElement).querySelector(
      'button.flag-fab'
    );
    expect(fab).not.toBeNull();
  });

  it('toggleFlag() calls the store and notifies success', async () => {
    const includedFlag = {
      ...flag,
      rules: [
        {
          id: 'r1',
          flagId: flag.id,
          effect: 'include' as const,
          payload: { type: 'percentage' as const, percent: 10 },
          createdAt: flag.createdAt,
          updatedAt: flag.updatedAt
        }
      ]
    };
    const fixture = TestBed.createComponent(FeatureFlagListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    fixture.componentInstance.toggleFlag(includedFlag);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(toggleSpy).toHaveBeenCalledWith('flag-1');
  });

  describe('enable-without-rules confirmation', () => {
    it('confirms before enabling a disabled flag with no include rules', async () => {
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      fixture.componentInstance.toggleFlag(flag); // disabled, rules: []
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(toggleSpy).toHaveBeenCalledWith('flag-1');
    });

    it('does not toggle when the confirmation is cancelled', async () => {
      confirmSpy.mockReturnValue(of(false));
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      fixture.componentInstance.toggleFlag(flag);
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(toggleSpy).not.toHaveBeenCalled();
    });

    it('skips the confirmation when an include rule exists', async () => {
      const includedFlag = {
        ...flag,
        rules: [
          {
            id: 'r1',
            flagId: flag.id,
            effect: 'include' as const,
            payload: { type: 'percentage' as const, percent: 10 },
            createdAt: flag.createdAt,
            updatedAt: flag.updatedAt
          }
        ]
      };
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      fixture.componentInstance.toggleFlag(includedFlag);
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(toggleSpy).toHaveBeenCalledWith('flag-1');
    });

    it('skips the confirmation when disabling an enabled flag', async () => {
      const enabledNoRules = { ...flag, enabled: true };
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      fixture.componentInstance.toggleFlag(enabledNoRules);
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(toggleSpy).toHaveBeenCalledWith('flag-1');
    });
  });

  describe('FF-UX-007 — handset shows "All environments" when list is empty', () => {
    it('renders the environments dt/dd pair with "All environments" label', async () => {
      const flagAllEnvs = { ...flag, id: 'flag-all', environments: [] };
      serviceMock.getAllCursor.mockReturnValue(
        of({
          data: [flagAllEnvs],
          meta: { nextCursor: null, hasMore: false, limit: 20 }
        })
      );
      layoutHandset.set(true);
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const card = (fixture.nativeElement as HTMLElement).querySelector(
        '.flag-card'
      );
      expect(card).not.toBeNull();
      const cardText = card?.textContent ?? '';
      expect(cardText).toContain('Environments');
      expect(cardText).toContain('All environments');
    });

    it('omits the "All environments" label when the flag has specific environments', async () => {
      layoutHandset.set(true);
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const cardText =
        (fixture.nativeElement as HTMLElement).querySelector('.flag-card')
          ?.textContent ?? '';
      expect(cardText).toContain('production');
      expect(cardText).not.toContain('All environments');
    });
  });

  // The flag and its rules travel in one request, so there is no state in
  // which the flag saved and the rules did not.
  describe('save in one request', () => {
    const rules = [
      {
        effect: 'include' as const,
        type: 'role' as const,
        payload: { type: 'role' as const, roleNames: ['beta'] }
      }
    ];
    const flagFields = {
      description: 'updated',
      enabled: true,
      environments: ['production'],
      public: false
    };

    async function openList(): Promise<FeatureFlagListComponent> {
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      return fixture.componentInstance;
    }

    it('creates a flag with its rules in one call', async () => {
      const created = { ...flag, id: 'flag-new', key: 'just-created' };
      serviceMock.create.mockReturnValue(of(created));
      stubDialogResult({
        key: 'just-created',
        flag: { ...flagFields, rules }
      });

      (await openList()).openCreateDialog();

      expect(serviceMock.create).toHaveBeenCalledTimes(1);
      expect(serviceMock.create).toHaveBeenCalledWith({
        key: 'just-created',
        ...flagFields,
        rules
      });
      expect(notifySuccess).toHaveBeenCalledWith(
        'admin.featureFlags.successCreated',
        { key: 'just-created' }
      );
      expect(notifyError).not.toHaveBeenCalled();
    });

    it('updates a flag with its rules in one call, without the key', async () => {
      serviceMock.update.mockReturnValue(of(flag));
      stubDialogResult({ key: flag.key, flag: { ...flagFields, rules } });

      (await openList()).openEditDialog(flag);

      expect(serviceMock.update).toHaveBeenCalledTimes(1);
      expect(serviceMock.update).toHaveBeenCalledWith(
        'flag-1',
        { ...flagFields, rules },
        flag.version
      );
      expect(serviceMock.update.mock.calls[0][1]).not.toHaveProperty('key');
      expect(notifySuccess).toHaveBeenCalledWith(
        'admin.featureFlags.successUpdated',
        { key: 'new-dashboard' }
      );
    });

    it('sends an empty rule set when the admin removed every rule', async () => {
      serviceMock.update.mockReturnValue(of(flag));
      stubDialogResult({ key: flag.key, flag: { ...flagFields, rules: [] } });

      (await openList()).openEditDialog(flag);

      expect(serviceMock.update.mock.calls[0][1]).toEqual({
        ...flagFields,
        rules: []
      });
    });

    it('reports a rejected create once, with the server text', async () => {
      const error = new HttpErrorResponse({
        status: 400,
        error: { message: 'user rule requires userIds: an array' }
      });
      serviceMock.create.mockReturnValue(throwError(() => error));
      stubDialogResult({
        key: 'just-created',
        flag: { ...flagFields, rules }
      });

      (await openList()).openCreateDialog();

      expect(notifySuccess).not.toHaveBeenCalled();
      expect(notifyError).toHaveBeenCalledTimes(1);
      expect(notifyError).toHaveBeenCalledWith(
        error,
        'admin.featureFlags.errorCreateFailed'
      );
    });

    it('reports a rejected update once and keeps the stored row', async () => {
      const error = new HttpErrorResponse({ status: 400 });
      serviceMock.update.mockReturnValue(throwError(() => error));
      stubDialogResult({ key: flag.key, flag: { ...flagFields, rules } });

      const list = await openList();
      list.openEditDialog(flag);

      expect(notifySuccess).not.toHaveBeenCalled();
      expect(notifyError).toHaveBeenCalledWith(
        error,
        'admin.featureFlags.errorUpdateFailed'
      );
      expect(list.flags()).toEqual([flag]);
    });
  });
});
