import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  MatSlideToggle,
  MatSlideToggleChange
} from '@angular/material/slide-toggle';
import { signal, ViewContainerRef } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { TranslocoTestingModuleWithLangs } from '../../../../../../test-utils/transloco-testing';
import { LayoutService } from '@core/services/layout.service';
import { NotifyService } from '@core/services/notify.service';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { FeatureFlagsAdminStore } from '../../../store/feature-flags-admin.store';
import { FeatureFlagsAdminService } from '../../../services/feature-flags-admin.service';
import type { FeatureFlagResponse } from '@app/shared/types';
import { FeatureFlagFormDialogComponent } from '../feature-flag-form-dialog/feature-flag-form-dialog.component';
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

  let updateSpy: ReturnType<typeof vi.fn>;
  let confirmSpy: ReturnType<typeof vi.fn>;
  let layoutHandset: ReturnType<typeof signal<boolean>>;
  let notifySuccess: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let hasPermissions: ReturnType<typeof vi.fn>;
  let serviceMock: {
    getAllCursor: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    getOne: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    updateSpy = vi
      .fn()
      .mockReturnValue(of({ ...flag, enabled: true, version: 2 }));
    confirmSpy = vi.fn().mockReturnValue(of(true));
    layoutHandset = signal(false);
    notifySuccess = vi.fn();
    notifyError = vi.fn();

    serviceMock = {
      getAllCursor: vi.fn().mockReturnValue(
        of({
          data: [flag],
          meta: { nextCursor: null, hasMore: false, limit: 20 }
        })
      ),
      create: vi.fn(),
      update: updateSpy,
      delete: vi.fn(),
      getOne: vi.fn()
    };

    dialogOpen = vi.fn();
    hasPermissions = vi.fn().mockReturnValue(true);

    await TestBed.configureTestingModule({
      imports: [FeatureFlagListComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
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
          useValue: { hasPermissions }
        }
      ]
    })
      .overrideComponent(FeatureFlagListComponent, {
        set: { providers: [] }
      })
      .compileComponents();
  });

  function stubDialogResult(result: FeatureFlagResponse | undefined): void {
    dialogOpen.mockReturnValue({ afterClosed: () => of(result) });
  }

  function changeOf(
    fixture: ComponentFixture<FeatureFlagListComponent>
  ): MatSlideToggleChange {
    fixture.detectChanges();
    const toggle: MatSlideToggle = fixture.debugElement.query(
      By.directive(MatSlideToggle)
    ).componentInstance;
    return new MatSlideToggleChange(toggle, !toggle.checked);
  }

  async function clickSwitch(
    fixture: ComponentFixture<FeatureFlagListComponent>
  ): Promise<string | null> {
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('button[role="switch"]')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    return (
      host
        .querySelector('button[role="switch"]')
        ?.getAttribute('aria-checked') ?? null
    );
  }

  describe('the row switch', () => {
    async function renderList(): Promise<
      ComponentFixture<FeatureFlagListComponent>
    > {
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      return fixture;
    }

    it('shows the flag state', async () => {
      const fixture = await renderList();
      const toggle = (fixture.nativeElement as HTMLElement).querySelector(
        'button[role="switch"]'
      );
      expect(toggle?.getAttribute('aria-checked')).toBe('false');
      expect(toggle?.getAttribute('aria-label')).toBe(
        'Toggle flag new-dashboard'
      );
    });

    it('stays on after a successful enable', async () => {
      const fixture = await renderList();
      expect(await clickSwitch(fixture)).toBe('true');
      expect(updateSpy).toHaveBeenCalledWith('flag-1', { enabled: true }, 1);
    });

    it('moves back when the confirmation is cancelled', async () => {
      confirmSpy.mockReturnValue(of(false));
      const fixture = await renderList();
      expect(await clickSwitch(fixture)).toBe('false');
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('moves back when the write fails', async () => {
      updateSpy.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 500 }))
      );
      const fixture = await renderList();
      expect(await clickSwitch(fixture)).toBe('false');
      expect(notifyError).toHaveBeenCalledTimes(1);
    });
  });

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

  it('opens a link with its filters and sort, and pages on with the same ones', async () => {
    serviceMock.getAllCursor
      .mockReturnValueOnce(
        of({
          data: [flag],
          meta: { nextCursor: 'cursor-1', hasMore: true, limit: 20 }
        })
      )
      .mockReturnValueOnce(
        of({
          data: [{ ...flag, id: 'flag-2', key: 'other' }],
          meta: { nextCursor: null, hasMore: false, limit: 20 }
        })
      );
    await TestBed.inject(Router).navigateByUrl(
      '/?flags.enabled=false&flags.sortBy=key&flags.sortOrder=asc&flags.junk=1'
    );

    const fixture = TestBed.createComponent(FeatureFlagListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.loadMore();
    await fixture.whenStable();

    expect(serviceMock.getAllCursor.mock.calls).toEqual([
      [
        { cursor: null, limit: 20, sortBy: 'key', sortOrder: 'asc' },
        { enabled: false }
      ],
      [
        { cursor: 'cursor-1', limit: 20, sortBy: 'key', sortOrder: 'asc' },
        { enabled: false }
      ]
    ]);
    expect(fixture.componentInstance.flags().map((f) => f.id)).toEqual([
      'flag-1',
      'flag-2'
    ]);
    // The unknown param is dropped from the address; the list's own stay.
    expect(TestBed.inject(Router).url).toBe(
      '/?flags.enabled=false&flags.sortBy=key&flags.sortOrder=asc'
    );
  });

  it('decides the row buttons with the flag itself', async () => {
    hasPermissions.mockImplementation(
      (check: { instance?: unknown }) => check.instance === undefined
    );
    const fixture = TestBed.createComponent(FeatureFlagListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const row = (fixture.nativeElement as HTMLElement).querySelector(
      'table tbody tr'
    );
    expect(row?.querySelectorAll('button:not([role="switch"])').length).toBe(0);
    const toggle = row?.querySelector('button[role="switch"]');
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
    expect(toggle?.hasAttribute('disabled')).toBe(true);
    expect(hasPermissions).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        subject: 'FeatureFlag',
        instance: expect.objectContaining({ key: 'new-dashboard' })
      })
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
    fixture.componentInstance.toggleFlag(includedFlag, changeOf(fixture));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith('flag-1', { enabled: true }, 1);
    expect(notifySuccess).toHaveBeenCalledWith(
      'admin.featureFlags.successEnabled',
      { key: 'new-dashboard' }
    );
  });

  it('toggleFlag() reloads the row after a version conflict', async () => {
    const conflict = new HttpErrorResponse({
      status: 409,
      error: {
        message: 'Feature flag was modified by another request',
        errorKey: 'errors.featureFlags.versionConflict'
      }
    });
    const fresh = { ...flag, enabled: true, version: 2 };
    updateSpy.mockReturnValue(throwError(() => conflict));
    serviceMock.getOne.mockReturnValue(of(fresh));
    const fixture = TestBed.createComponent(FeatureFlagListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.toggleFlag(
      { ...flag, enabled: true },
      changeOf(fixture)
    );

    expect(updateSpy).toHaveBeenCalledWith('flag-1', { enabled: false }, 1);
    expect(notifyError).toHaveBeenCalledWith(
      conflict,
      'admin.featureFlags.errorToggleFailed'
    );
    expect(serviceMock.getOne).toHaveBeenCalledWith('flag-1');
    expect(fixture.componentInstance.flags()).toEqual([fresh]);
  });

  it('toggleFlag() does not reload the row after another error', async () => {
    const error = new HttpErrorResponse({ status: 500 });
    updateSpy.mockReturnValue(throwError(() => error));
    const fixture = TestBed.createComponent(FeatureFlagListComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.toggleFlag(
      { ...flag, enabled: true },
      changeOf(fixture)
    );

    expect(notifyError).toHaveBeenCalledWith(
      error,
      'admin.featureFlags.errorToggleFailed'
    );
    expect(serviceMock.getOne).not.toHaveBeenCalled();
  });

  describe('enable-without-rules confirmation', () => {
    it('confirms before enabling a disabled flag with no include rules', async () => {
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      fixture.componentInstance.toggleFlag(flag, changeOf(fixture)); // disabled, rules: []
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith('flag-1', { enabled: true }, 1);
    });

    it('does not toggle when the confirmation is cancelled', async () => {
      confirmSpy.mockReturnValue(of(false));
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      fixture.componentInstance.toggleFlag(flag, changeOf(fixture));
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).not.toHaveBeenCalled();
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
      fixture.componentInstance.toggleFlag(includedFlag, changeOf(fixture));
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(updateSpy).toHaveBeenCalledWith('flag-1', { enabled: true }, 1);
    });

    it('skips the confirmation when disabling an enabled flag', async () => {
      const enabledNoRules = { ...flag, enabled: true };
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      fixture.componentInstance.toggleFlag(enabledNoRules, changeOf(fixture));
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(updateSpy).toHaveBeenCalledWith('flag-1', { enabled: false }, 1);
    });
  });

  describe('FF-UX-007 — handset shows "All" when list is empty', () => {
    it('renders the environments dt/dd pair with the "All" label', async () => {
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
      expect(
        card?.querySelector('.flag-card-fields dd')?.textContent?.trim()
      ).toBe('All');
    });

    it('omits the "All" label when the flag has specific environments', async () => {
      layoutHandset.set(true);
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const envCell = (fixture.nativeElement as HTMLElement).querySelector(
        '.flag-card .flag-card-fields dd'
      );
      expect(envCell?.textContent).toContain('production');
      expect(envCell?.textContent).not.toContain('All');
    });
  });

  describe('the form dialog', () => {
    async function openList(): Promise<FeatureFlagListComponent> {
      const fixture = TestBed.createComponent(FeatureFlagListComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      return fixture.componentInstance;
    }

    it('reports a created flag by the key the server saved', async () => {
      stubDialogResult({ ...flag, id: 'flag-new', key: 'just-created' });

      (await openList()).openCreateDialog();

      expect(notifySuccess).toHaveBeenCalledExactlyOnceWith(
        'admin.featureFlags.successCreated',
        { key: 'just-created' }
      );
    });

    it('reports an updated flag and passes the flag to the dialog', async () => {
      stubDialogResult(flag);

      (await openList()).openEditDialog(flag);

      expect(dialogOpen).toHaveBeenCalledWith(
        FeatureFlagFormDialogComponent,
        // The store is provided on the admin route, so the dialog needs the
        // injector of the list to reach it.
        expect.objectContaining({
          data: { flag },
          viewContainerRef: expect.any(ViewContainerRef)
        })
      );
      expect(notifySuccess).toHaveBeenCalledExactlyOnceWith(
        'admin.featureFlags.successUpdated',
        { key: 'new-dashboard' }
      );
    });

    it('reports nothing and sends no request when the dialog is cancelled', async () => {
      stubDialogResult(undefined);

      (await openList()).openEditDialog(flag);

      expect(notifySuccess).not.toHaveBeenCalled();
      expect(notifyError).not.toHaveBeenCalled();
      expect(serviceMock.create).not.toHaveBeenCalled();
      expect(serviceMock.update).not.toHaveBeenCalled();
    });
  });
});
