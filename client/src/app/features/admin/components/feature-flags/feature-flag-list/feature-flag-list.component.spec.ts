import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
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
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    toggle: ReturnType<typeof vi.fn>;
    replaceRules: ReturnType<typeof vi.fn>;
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
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      toggle: toggleSpy,
      replaceRules: vi.fn()
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

  it('renders the desktop table with one row per flag', () => {
    const fixture = TestBed.createComponent(FeatureFlagListComponent);
    fixture.detectChanges();
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'table tbody tr'
    );
    expect(rows.length).toBe(1);
    expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain(
      'new-dashboard'
    );
  });

  it('switches to a card list on handset', () => {
    layoutHandset.set(true);
    const fixture = TestBed.createComponent(FeatureFlagListComponent);
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

  it('toggleFlag() calls the store and notifies success', () => {
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
    fixture.componentInstance.toggleFlag(includedFlag);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(toggleSpy).toHaveBeenCalledWith('flag-1');
  });

  describe('enable-without-rules confirmation', () => {
    it('confirms before enabling a disabled flag with no include rules', () => {
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      fixture.componentInstance.toggleFlag(flag); // disabled, rules: []
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(toggleSpy).toHaveBeenCalledWith('flag-1');
    });

    it('does not toggle when the confirmation is cancelled', () => {
      confirmSpy.mockReturnValue(of(false));
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      fixture.componentInstance.toggleFlag(flag);
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(toggleSpy).not.toHaveBeenCalled();
    });

    it('skips the confirmation when an include rule exists', () => {
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
      fixture.componentInstance.toggleFlag(includedFlag);
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(toggleSpy).toHaveBeenCalledWith('flag-1');
    });

    it('skips the confirmation when disabling an enabled flag', () => {
      const enabledNoRules = { ...flag, enabled: true };
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      fixture.componentInstance.toggleFlag(enabledNoRules);
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(toggleSpy).toHaveBeenCalledWith('flag-1');
    });
  });

  describe('FF-UX-007 — handset shows "All environments" when list is empty', () => {
    it('renders the environments dt/dd pair with "All environments" label', () => {
      const flagAllEnvs = { ...flag, id: 'flag-all', environments: [] };
      serviceMock.getAll.mockReturnValue(of([flagAllEnvs]));
      layoutHandset.set(true);
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      const card = (fixture.nativeElement as HTMLElement).querySelector(
        '.flag-card'
      );
      expect(card).not.toBeNull();
      const cardText = card?.textContent ?? '';
      expect(cardText).toContain('Environments');
      expect(cardText).toContain('All environments');
    });

    it('omits the "All environments" label when the flag has specific environments', () => {
      layoutHandset.set(true);
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      const cardText =
        (fixture.nativeElement as HTMLElement).querySelector('.flag-card')
          ?.textContent ?? '';
      expect(cardText).toContain('production');
      expect(cardText).not.toContain('All environments');
    });
  });

  describe('FF-UX-008 — composite outcome for create + replaceRules', () => {
    const createdFlag = { ...flag, id: 'flag-new', key: 'just-created' };
    const dialogResult: FeatureFlagFormDialogResult = {
      flag: {
        key: 'just-created',
        description: null,
        enabled: false,
        environments: [],
        public: false
      },
      rules: [
        {
          effect: 'include',
          type: 'role',
          payload: { type: 'role', roleNames: ['beta'] }
        }
      ],
      rulesChanged: true
    };

    it('defers success snackbar until replaceRules resolves', () => {
      serviceMock.create.mockReturnValue(of(createdFlag));
      serviceMock.replaceRules.mockReturnValue(of(createdFlag));
      stubDialogResult(dialogResult);

      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      fixture.componentInstance.openCreateDialog();

      expect(serviceMock.create).toHaveBeenCalled();
      expect(serviceMock.replaceRules).toHaveBeenCalledWith(
        'flag-new',
        dialogResult.rules
      );
      expect(notifySuccess).toHaveBeenCalledTimes(1);
      expect(notifySuccess).toHaveBeenCalledWith(
        'admin.featureFlags.successCreated',
        { key: 'just-created' }
      );
      expect(notifyError).not.toHaveBeenCalled();
    });

    it('fires success snackbar immediately when there are no rules to save', () => {
      serviceMock.create.mockReturnValue(of(createdFlag));
      stubDialogResult({ ...dialogResult, rules: [] });

      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      fixture.componentInstance.openCreateDialog();

      expect(serviceMock.replaceRules).not.toHaveBeenCalled();
      expect(notifySuccess).toHaveBeenCalledWith(
        'admin.featureFlags.successCreated',
        { key: 'just-created' }
      );
    });

    it('on replaceRules failure: no success snackbar, distinct error snackbar, flag marked', () => {
      serviceMock.create.mockReturnValue(of(createdFlag));
      serviceMock.replaceRules.mockReturnValue(
        throwError(() => new Error('boom'))
      );
      stubDialogResult(dialogResult);

      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      fixture.componentInstance.openCreateDialog();

      expect(notifySuccess).not.toHaveBeenCalled();
      expect(notifyError).toHaveBeenCalledWith(
        'admin.featureFlags.errorRulesFailedCreate',
        { key: 'just-created' }
      );
      expect(
        fixture.componentInstance.rulesFailedFlagIds().has('flag-new')
      ).toBe(true);
    });

    it('successful re-save clears the rules-failed marker', () => {
      serviceMock.create.mockReturnValueOnce(of(createdFlag));
      serviceMock.replaceRules.mockReturnValueOnce(
        throwError(() => new Error('boom'))
      );
      stubDialogResult(dialogResult);

      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      fixture.componentInstance.openCreateDialog();
      expect(
        fixture.componentInstance.rulesFailedFlagIds().has('flag-new')
      ).toBe(true);

      serviceMock.update.mockReturnValue(of(createdFlag));
      serviceMock.replaceRules.mockReturnValueOnce(of(createdFlag));
      stubDialogResult(dialogResult);
      fixture.componentInstance.openEditDialog(createdFlag);

      expect(
        fixture.componentInstance.rulesFailedFlagIds().has('flag-new')
      ).toBe(false);
    });
  });

  describe('FF-UX-008 — composite outcome for update + replaceRules', () => {
    const dialogResult: FeatureFlagFormDialogResult = {
      flag: {
        key: 'new-dashboard',
        description: 'updated',
        enabled: true,
        environments: ['production'],
        public: false
      },
      rules: [
        {
          effect: 'include',
          type: 'percentage',
          payload: { type: 'percentage', percent: 50 }
        }
      ],
      rulesChanged: true
    };

    it('defers success snackbar until replaceRules resolves', () => {
      serviceMock.update.mockReturnValue(of(flag));
      serviceMock.replaceRules.mockReturnValue(of(flag));
      stubDialogResult(dialogResult);

      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      fixture.componentInstance.openEditDialog(flag);

      expect(notifySuccess).toHaveBeenCalledTimes(1);
      expect(notifySuccess).toHaveBeenCalledWith(
        'admin.featureFlags.successUpdated',
        { key: 'new-dashboard' }
      );
    });

    it('on replaceRules failure: no success snackbar, distinct error snackbar, flag marked', () => {
      serviceMock.update.mockReturnValue(of(flag));
      serviceMock.replaceRules.mockReturnValue(
        throwError(() => new Error('boom'))
      );
      stubDialogResult(dialogResult);

      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      fixture.componentInstance.openEditDialog(flag);

      expect(notifySuccess).not.toHaveBeenCalled();
      expect(notifyError).toHaveBeenCalledWith(
        'admin.featureFlags.errorRulesFailedUpdate',
        { key: 'new-dashboard' }
      );
      expect(fixture.componentInstance.rulesFailedFlagIds().has('flag-1')).toBe(
        true
      );
    });

    it('fires success snackbar immediately when rulesChanged is false', () => {
      serviceMock.update.mockReturnValue(of(flag));
      stubDialogResult({ ...dialogResult, rulesChanged: false });

      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      fixture.componentInstance.openEditDialog(flag);

      expect(serviceMock.replaceRules).not.toHaveBeenCalled();
      expect(notifySuccess).toHaveBeenCalledWith(
        'admin.featureFlags.successUpdated',
        { key: 'new-dashboard' }
      );
    });

    // Clearing every rule via the dialog produces rules=[] AND rulesChanged=true.
    // We MUST still PUT the empty array so the server-side rules are wiped —
    // an earlier refactor short-circuited on rules.length===0 and silently
    // dropped the clear-all operation.
    it('calls replaceRules with empty array when user removed all rules', () => {
      serviceMock.update.mockReturnValue(of(flag));
      serviceMock.replaceRules.mockReturnValue(of(flag));
      stubDialogResult({ ...dialogResult, rules: [], rulesChanged: true });

      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      fixture.componentInstance.openEditDialog(flag);

      expect(serviceMock.replaceRules).toHaveBeenCalledWith('flag-1', []);
      expect(notifySuccess).toHaveBeenCalledWith(
        'admin.featureFlags.successUpdated',
        { key: 'new-dashboard' }
      );
    });
  });

  describe('FF-UX-008 — warning marker in desktop table', () => {
    it('renders the warning icon next to the key when rules failed', () => {
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();

      const before = (fixture.nativeElement as HTMLElement).querySelector(
        'td .rules-warning'
      );
      expect(before).toBeNull();

      serviceMock.update.mockReturnValue(of(flag));
      serviceMock.replaceRules.mockReturnValue(
        throwError(() => new Error('boom'))
      );
      stubDialogResult({
        flag: {
          key: flag.key,
          description: flag.description,
          enabled: flag.enabled,
          environments: flag.environments,
          public: flag.public
        },
        rules: [
          {
            effect: 'include',
            type: 'percentage',
            payload: { type: 'percentage', percent: 10 }
          }
        ],
        rulesChanged: true
      });
      fixture.componentInstance.openEditDialog(flag);
      fixture.detectChanges();

      const after = (fixture.nativeElement as HTMLElement).querySelector(
        'td .rules-warning'
      );
      expect(after).not.toBeNull();
    });
  });
});
