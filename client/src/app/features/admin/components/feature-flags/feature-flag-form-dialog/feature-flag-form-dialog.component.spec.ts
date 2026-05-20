import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { FeatureFlagRuleResponse } from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../../test-utils/transloco-testing';
import { KeyboardShortcutsService } from '@core/services/keyboard-shortcuts.service';
import type { FeatureFlagFormDialogResult } from './feature-flag-form-dialog.component';
import { FeatureFlagFormDialogComponent } from './feature-flag-form-dialog.component';

describe('FeatureFlagFormDialogComponent', () => {
  let closeSpy: ReturnType<typeof vi.fn>;

  const setup = async (
    data: Record<string, unknown> = {}
  ): Promise<ComponentFixture<FeatureFlagFormDialogComponent>> => {
    closeSpy = vi.fn();
    await TestBed.configureTestingModule({
      imports: [
        FeatureFlagFormDialogComponent,
        TranslocoTestingModuleWithLangs
      ],
      providers: [
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: data },
        {
          provide: MatDialogRef,
          useValue: { close: closeSpy }
        },
        {
          provide: KeyboardShortcutsService,
          useValue: { registerSave: vi.fn(() => () => undefined) }
        }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(FeatureFlagFormDialogComponent);
    fixture.detectChanges();
    return fixture;
  };

  it('opens in create mode with empty fields', async () => {
    const fixture = await setup({});
    const title = (fixture.nativeElement as HTMLElement)
      .querySelector('[mat-dialog-title]')
      ?.textContent?.trim();
    expect(title).toContain('Create');
    expect(fixture.componentInstance.model().key).toBe('');
    expect(fixture.componentInstance.enabled()).toBe(false);
  });

  it('opens in edit mode and hydrates rules from the flag', async () => {
    const fixture = await setup({
      flag: {
        id: 'flag-1',
        key: 'new-dashboard',
        description: 'rollout',
        enabled: true,
        environments: ['production'],
        public: false,
        version: 3,
        updatedByUserId: null,
        createdAt: '2026-05-19T10:00:00Z',
        updatedAt: '2026-05-19T10:00:00Z',
        rules: [
          {
            id: 'rule-1',
            flagId: 'flag-1',
            effect: 'include',
            payload: { type: 'percentage', percent: 10 },
            createdAt: '2026-05-19T10:00:00Z',
            updatedAt: '2026-05-19T10:00:00Z'
          }
        ] satisfies FeatureFlagRuleResponse[]
      }
    });
    const title = (fixture.nativeElement as HTMLElement)
      .querySelector('[mat-dialog-title]')
      ?.textContent?.trim();
    expect(title).toContain('Edit');
    expect(fixture.componentInstance.model().key).toBe('new-dashboard');
    expect(fixture.componentInstance.enabled()).toBe(true);
    expect(fixture.componentInstance.rules().length).toBe(1);
    expect(fixture.componentInstance.rules()[0].type).toBe('percentage');
  });

  it('addRule + removeRule mutate the rules signal', async () => {
    const fixture = await setup({});
    const cmp = fixture.componentInstance;
    cmp.addRule();
    cmp.addRule();
    expect(cmp.rules().length).toBe(2);

    cmp.removeRule(0);
    expect(cmp.rules().length).toBe(1);
  });

  it('submit serialises rules in render order', async () => {
    const fixture = await setup({});
    const cmp = fixture.componentInstance;
    cmp.model.set({
      key: 'new-dashboard',
      description: '',
      environments: ''
    });
    cmp.addRule();
    cmp.addRule();
    cmp.submit();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    const result = closeSpy.mock.calls[0][0] as FeatureFlagFormDialogResult;
    expect(result.rules).toEqual([
      {
        effect: 'include',
        type: 'percentage',
        payload: { type: 'percentage', percent: 0 }
      },
      {
        effect: 'include',
        type: 'percentage',
        payload: { type: 'percentage', percent: 0 }
      }
    ]);
  });

  it('renders rules without drag handles', async () => {
    const fixture = await setup({});
    fixture.componentInstance.addRule();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[cdkDropList]')).toBeNull();
    expect(root.querySelector('[cdkDrag]')).toBeNull();
    expect(root.querySelector('.drag-handle')).toBeNull();
  });

  it('submit() closes with the form result when the form is valid', async () => {
    const fixture = await setup({});
    const cmp = fixture.componentInstance;
    cmp.model.set({
      key: 'new-dashboard',
      description: 'rollout',
      environments: 'production, staging'
    });
    cmp.onEnabledChange(true);
    cmp.submit();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    const result = closeSpy.mock.calls[0][0] as FeatureFlagFormDialogResult;
    expect(result.flag.key).toBe('new-dashboard');
    expect(result.flag.enabled).toBe(true);
    expect(result.flag.environments).toEqual(['production', 'staging']);
  });

  it('submit() is a no-op when the key fails validation', async () => {
    const fixture = await setup({});
    const cmp = fixture.componentInstance;
    cmp.model.set({
      key: 'INVALID_KEY',
      description: '',
      environments: ''
    });
    cmp.submit();
    expect(closeSpy).not.toHaveBeenCalled();
  });
});
