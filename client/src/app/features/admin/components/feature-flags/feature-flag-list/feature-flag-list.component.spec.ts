import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { TranslocoTestingModuleWithLangs } from '../../../../../../test-utils/transloco-testing';
import { LayoutService } from '@core/services/layout.service';
import { NotifyService } from '@core/services/notify.service';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { FeatureFlagsAdminStore } from '../../../store/feature-flags-admin.store';
import { FeatureFlagsAdminService } from '../../../services/feature-flags-admin.service';
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
  let layoutHandset: ReturnType<typeof signal<boolean>>;
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
    layoutHandset = signal(false);

    serviceMock = {
      getAll: vi.fn().mockReturnValue(of([flag])),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      toggle: toggleSpy,
      replaceRules: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [FeatureFlagListComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        FeatureFlagsAdminStore,
        { provide: FeatureFlagsAdminService, useValue: serviceMock },
        {
          provide: NotifyService,
          useValue: { success: vi.fn(), error: vi.fn() }
        },
        {
          provide: AdaptiveDialogService,
          useValue: { openConfirm: vi.fn().mockReturnValue(of(false)) }
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
    const fixture = TestBed.createComponent(FeatureFlagListComponent);
    fixture.detectChanges();
    fixture.componentInstance.toggleFlag(flag);
    expect(toggleSpy).toHaveBeenCalledWith('flag-1');
  });
});
