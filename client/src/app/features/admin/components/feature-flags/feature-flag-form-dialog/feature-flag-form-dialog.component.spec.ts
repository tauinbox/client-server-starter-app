import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { NEVER, of, throwError, type Observable } from 'rxjs';
import type {
  FeatureFlagAttributeKeysResponse,
  FeatureFlagResponse,
  FeatureFlagRulePayload,
  FeatureFlagRuleResponse
} from '@app/shared/types';
import {
  APP_ENVIRONMENTS,
  BILLING_PROVIDER_FLAGS
} from '@app/shared/constants';
import { TranslocoTestingModuleWithLangs } from '../../../../../../test-utils/transloco-testing';
import { KeyboardShortcutsService } from '@core/services/keyboard-shortcuts.service';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { RoleCatalogService } from '@core/services/role-catalog.service';
import { UserService } from '../../../../users/services/user.service';
import type {
  CreateFeatureFlag,
  UpdateFeatureFlag
} from '../../../services/feature-flags-admin.service';
import { FeatureFlagsAdminService } from '../../../services/feature-flags-admin.service';
import { FeatureFlagsAdminStore } from '../../../store/feature-flags-admin.store';
import { FeatureFlagFormDialogComponent } from './feature-flag-form-dialog.component';

describe('FeatureFlagFormDialogComponent', () => {
  const savedFlag: FeatureFlagResponse = {
    id: 'flag-1',
    key: 'new-dashboard',
    description: null,
    enabled: false,
    environments: [],
    public: false,
    version: 2,
    updatedByUserId: null,
    createdAt: '2026-05-19T10:00:00Z',
    updatedAt: '2026-05-19T10:00:00Z',
    rules: []
  };

  let closeSpy: ReturnType<typeof vi.fn>;
  let confirmSpy: ReturnType<typeof vi.fn>;
  let createSpy: ReturnType<
    typeof vi.fn<(data: CreateFeatureFlag) => Observable<FeatureFlagResponse>>
  >;
  let updateSpy: ReturnType<
    typeof vi.fn<
      (
        id: string,
        data: UpdateFeatureFlag,
        expectedVersion: number
      ) => Observable<FeatureFlagResponse>
    >
  >;

  // The body of the one save request, create or update.
  const sentFlag = (): UpdateFeatureFlag | CreateFeatureFlag | undefined =>
    createSpy.mock.calls[0]?.[0] ?? updateSpy.mock.calls[0]?.[1];

  const setup = async (
    data: Record<string, unknown> = {},
    attributeKeys$: Observable<FeatureFlagAttributeKeysResponse> = of({
      customKeys: ['billingConfigured', 'oauthGoogleConfigured']
    })
  ): Promise<ComponentFixture<FeatureFlagFormDialogComponent>> => {
    closeSpy = vi.fn();
    confirmSpy = vi.fn(() => of(true));
    // jsdom has no layout, so it does not implement scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
    createSpy = vi.fn(() => of(savedFlag));
    updateSpy = vi.fn(() => of(savedFlag));
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
        },
        {
          provide: AdaptiveDialogService,
          useValue: { openConfirm: confirmSpy }
        },
        {
          provide: RoleCatalogService,
          useValue: { getAll: vi.fn(() => of([])) }
        },
        {
          provide: FeatureFlagsAdminService,
          useValue: { getAttributeKeys: vi.fn(() => attributeKeys$) }
        },
        {
          provide: FeatureFlagsAdminStore,
          useValue: { createFlag: createSpy, updateFlag: updateSpy }
        },
        {
          provide: UserService,
          useValue: {
            searchCursor: vi.fn(() =>
              of({ data: [], meta: { nextCursor: null } })
            )
          }
        }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(FeatureFlagFormDialogComponent);
    fixture.detectChanges();
    return fixture;
  };

  const attributeRulePayload = {
    type: 'attribute',
    field: 'emailDomain',
    op: 'endsWith',
    value: '@acme.com'
  } satisfies FeatureFlagRulePayload;

  const flagWithAttributeRule = (
    payload: FeatureFlagRulePayload = attributeRulePayload
  ): Record<string, unknown> => ({
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
          payload,
          createdAt: '2026-05-19T10:00:00Z',
          updatedAt: '2026-05-19T10:00:00Z'
        }
      ] satisfies FeatureFlagRuleResponse[]
    }
  });

  it('opens in create mode with empty fields', async () => {
    const fixture = await setup({});
    const title = (fixture.nativeElement as HTMLElement)
      .querySelector('[mat-dialog-title]')
      ?.textContent?.trim();
    expect(title).toContain('Create');
    expect(fixture.componentInstance.model().key).toBe('');
    expect(fixture.componentInstance.enabled()).toBe(false);
    expect(fixture.componentInstance.environments()).toEqual([]);
  });

  it('opens in edit mode and hydrates environments + rules from the flag', async () => {
    const fixture = await setup({
      flag: {
        id: 'flag-1',
        key: 'new-dashboard',
        description: 'rollout',
        enabled: true,
        environments: ['production', 'staging'],
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
    expect(
      fixture.componentInstance.environments().map((c) => c.value)
    ).toEqual(['production', 'staging']);
    expect(fixture.componentInstance.rules().length).toBe(1);
    expect(fixture.componentInstance.rules()[0].type).toBe('percentage');
  });

  it('environmentOptions offers exactly the environments the API accepts', async () => {
    const fixture = await setup({});
    const opts = fixture.componentInstance['environmentOptions'].map(
      (c) => c.value
    );
    expect(opts).toEqual([...APP_ENVIRONMENTS]);
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

  it('submit serialises environments as a string array (not CSV)', async () => {
    const fixture = await setup({});
    const cmp = fixture.componentInstance;
    cmp.model.set({ key: 'new-dashboard', description: '' });
    cmp.environments.set([
      { value: 'production', label: 'production' },
      { value: 'staging', label: 'staging' }
    ]);
    cmp.submit();
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(sentFlag()?.environments).toEqual(['production', 'staging']);
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

  it('submit() creates the flag and closes with the saved flag', async () => {
    const fixture = await setup({});
    const cmp = fixture.componentInstance;
    cmp.model.set({ key: 'new-dashboard', description: 'rollout' });
    cmp.onEnabledChange(true);
    cmp.submit();
    expect(createSpy).toHaveBeenCalledWith({
      key: 'new-dashboard',
      description: 'rollout',
      enabled: true,
      environments: [],
      public: false
    });
    expect(closeSpy).toHaveBeenCalledExactlyOnceWith(savedFlag);
  });

  it('keeps the dialog open with the input and shows the error when the save fails', async () => {
    const fixture = await setup(flagWithAttributeRule());
    updateSpy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              message: 'Feature flag was modified by another request',
              errorKey: 'errors.featureFlags.versionConflict'
            }
          })
      )
    );
    const cmp = fixture.componentInstance;
    cmp.model.update((m) => ({ ...m, description: 'paused' }));
    cmp.addRule();
    await fixture.whenStable();

    cmp.submit();
    fixture.detectChanges();

    expect(updateSpy).toHaveBeenCalledWith('flag-1', expect.anything(), 3);
    expect(closeSpy).not.toHaveBeenCalled();
    expect(cmp.model().description).toBe('paused');
    expect(cmp.rules().length).toBe(2);
    const host = fixture.nativeElement as HTMLElement;
    const error = host.querySelector('.form-error');
    expect(error?.textContent?.trim()).toBe(
      'Feature flag was modified by another request. Reload and retry.'
    );
    await fixture.whenStable();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    const save = host.querySelector<HTMLButtonElement>(
      'mat-dialog-actions button[matButton="filled"]'
    );
    expect(save?.disabled).toBe(false);
  });

  it('sends one request while a save is in flight', async () => {
    const fixture = await setup({});
    createSpy.mockReturnValue(NEVER);
    const cmp = fixture.componentInstance;
    cmp.model.set({ key: 'new-dashboard', description: '' });
    cmp.submit();
    cmp.submit();
    fixture.detectChanges();

    expect(createSpy).toHaveBeenCalledTimes(1);
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'mat-dialog-actions button'
    );
    expect(Array.from(buttons).every((b) => b.hasAttribute('disabled'))).toBe(
      true
    );
  });

  it.each(BILLING_PROVIDER_FLAGS.map((p) => p.enabledFlagKey))(
    'saves an edit of the billing kill-switch %s',
    async (key) => {
      const fixture = await setup({
        flag: {
          id: 'flag-1',
          key,
          description: null,
          enabled: false,
          environments: [],
          public: false,
          version: 1,
          updatedByUserId: null,
          createdAt: '2026-05-19T10:00:00Z',
          updatedAt: '2026-05-19T10:00:00Z',
          rules: []
        }
      });
      const cmp = fixture.componentInstance;
      cmp.model.update((m) => ({ ...m, description: 'paused' }));
      await fixture.whenStable();
      cmp.submit();
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy.mock.calls[0][0]).toBe('flag-1');
      expect(sentFlag()).not.toHaveProperty('key');
      expect(closeSpy).toHaveBeenCalledTimes(1);
    }
  );

  it('shows the key read-only on edit and sends no key in the update body', async () => {
    const fixture = await setup(flagWithAttributeRule());
    await fixture.whenStable();
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      'nxs-form-field input'
    ) as HTMLInputElement;
    expect(input.readOnly).toBe(true);

    const cmp = fixture.componentInstance;
    cmp.model.update((m) => ({ ...m, description: 'paused' }));
    await fixture.whenStable();
    cmp.submit();
    expect(updateSpy).toHaveBeenCalledExactlyOnceWith(
      'flag-1',
      {
        description: 'paused',
        enabled: true,
        environments: ['production'],
        public: false
      },
      3
    );
  });

  it('keeps the key editable on create', async () => {
    const fixture = await setup({});
    await fixture.whenStable();
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      'nxs-form-field input'
    ) as HTMLInputElement;
    expect(input.readOnly).toBe(false);
  });

  it('submit() is a no-op when the key fails validation', async () => {
    const fixture = await setup({});
    const cmp = fixture.componentInstance;
    cmp.model.set({ key: 'INVALID_KEY', description: '' });
    cmp.submit();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('submit() confirms before saving an enabled flag with no include rules', async () => {
    const fixture = await setup({});
    const cmp = fixture.componentInstance;
    cmp.model.set({ key: 'new-dashboard', description: '' });
    cmp.onEnabledChange(true);
    cmp.submit();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('submit() does not close when the enable confirmation is cancelled', async () => {
    const fixture = await setup({});
    confirmSpy.mockReturnValue(of(false));
    const cmp = fixture.componentInstance;
    cmp.model.set({ key: 'new-dashboard', description: '' });
    cmp.onEnabledChange(true);
    cmp.submit();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('submit() skips the confirmation when an include rule exists', async () => {
    const fixture = await setup({});
    const cmp = fixture.componentInstance;
    cmp.model.set({ key: 'new-dashboard', description: '' });
    cmp.onEnabledChange(true);
    cmp.addRule(); // defaults to effect 'include'
    cmp.submit();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('leaves the rules out of the request when a payload only differs in key order', async () => {
    const fixture = await setup(flagWithAttributeRule());
    const cmp = fixture.componentInstance;
    cmp.updateRule(0, {
      id: 'rule-1',
      effect: 'include',
      type: 'attribute',
      payload: {
        value: '@acme.com',
        op: 'endsWith',
        field: 'emailDomain',
        type: 'attribute'
      }
    });
    cmp.submit();
    expect(sentFlag()).not.toHaveProperty('rules');
  });

  it('sends the full rule set when a payload value differs', async () => {
    const fixture = await setup(flagWithAttributeRule());
    const cmp = fixture.componentInstance;
    cmp.updateRule(0, {
      id: 'rule-1',
      effect: 'include',
      type: 'attribute',
      payload: {
        value: '@other.com',
        op: 'endsWith',
        field: 'emailDomain',
        type: 'attribute'
      }
    });
    cmp.submit();
    expect(sentFlag()?.rules).toEqual([
      {
        effect: 'include',
        type: 'attribute',
        payload: {
          value: '@other.com',
          op: 'endsWith',
          field: 'emailDomain',
          type: 'attribute'
        }
      }
    ]);
  });

  it('sends an empty rule set when every rule was removed', async () => {
    const fixture = await setup(flagWithAttributeRule());
    const cmp = fixture.componentInstance;
    cmp.removeRule(0);
    cmp.submit();
    expect(sentFlag()?.rules).toEqual([]);
  });

  it('leaves the rules out of a new flag that has none', async () => {
    const fixture = await setup({});
    const cmp = fixture.componentInstance;
    cmp.model.set({ key: 'new-dashboard', description: '' });
    cmp.submit();
    expect(sentFlag()).not.toHaveProperty('rules');
  });

  it('submit() is a no-op while a rule the server would reject is present', async () => {
    const fixture = await setup(flagWithAttributeRule());
    const cmp = fixture.componentInstance;
    cmp.updateRule(0, {
      id: 'rule-1',
      effect: 'include',
      type: 'attribute',
      payload: {
        type: 'attribute',
        field: 'createdAt',
        op: 'before',
        value: ''
      }
    });

    expect(cmp.hasRuleErrors()).toBe(true);
    expect(cmp.ruleErrors()).toEqual(['admin.featureFlagRule.errorValueDate']);
    cmp.submit();

    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('marks the offending row and disables the save button', async () => {
    const fixture = await setup(flagWithAttributeRule());
    const cmp = fixture.componentInstance;
    cmp.updateRule(0, {
      id: 'rule-1',
      effect: 'include',
      type: 'attribute',
      payload: {
        type: 'attribute',
        field: 'custom',
        op: 'eq',
        value: 'gold',
        customKey: ''
      }
    });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.rule-error')?.textContent?.trim()).toBe(
      'Enter the custom attribute key.'
    );
    const save = host.querySelector<HTMLButtonElement>(
      'mat-dialog-actions button[matButton="filled"]'
    );
    expect(save?.disabled).toBe(true);
  });

  it('submit() proceeds once the rule is completed', async () => {
    const fixture = await setup(flagWithAttributeRule());
    const cmp = fixture.componentInstance;
    cmp.updateRule(0, {
      id: 'rule-1',
      effect: 'include',
      type: 'attribute',
      payload: {
        type: 'attribute',
        field: 'createdAt',
        op: 'before',
        value: '2026-01-15T00:00:00.000Z'
      }
    });

    expect(cmp.hasRuleErrors()).toBe(false);
    cmp.submit();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('blocks a custom key the server has not registered', async () => {
    const fixture = await setup(flagWithAttributeRule());
    const cmp = fixture.componentInstance;
    cmp.updateRule(0, {
      id: 'rule-1',
      effect: 'include',
      type: 'attribute',
      payload: {
        type: 'attribute',
        field: 'custom',
        op: 'eq',
        value: 'gold',
        customKey: 'plan'
      }
    });
    fixture.detectChanges();

    expect(cmp.ruleErrors()).toEqual([
      'admin.featureFlagRule.errorCustomKeyUnknown'
    ]);
    cmp.submit();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('accepts a custom key the server reports', async () => {
    const fixture = await setup(flagWithAttributeRule());
    const cmp = fixture.componentInstance;
    cmp.updateRule(0, {
      id: 'rule-1',
      effect: 'include',
      type: 'attribute',
      payload: {
        type: 'attribute',
        field: 'custom',
        op: 'eq',
        value: 'gold',
        customKey: 'billingConfigured'
      }
    });

    expect(cmp.hasRuleErrors()).toBe(false);
  });

  // A catalog the admin cannot read must not block a save the server accepts.
  it('keeps the membership check off when the catalog request fails', async () => {
    const fixture = await setup(
      flagWithAttributeRule(),
      throwError(() => new Error('offline'))
    );
    const cmp = fixture.componentInstance;
    cmp.updateRule(0, {
      id: 'rule-1',
      effect: 'include',
      type: 'attribute',
      payload: {
        type: 'attribute',
        field: 'custom',
        op: 'eq',
        value: 'gold',
        customKey: 'plan'
      }
    });

    expect(cmp.hasRuleErrors()).toBe(false);
    expect(cmp['customKeyOptions']()).toEqual([]);
  });

  it('offers the reported keys to the rule rows', async () => {
    const fixture = await setup(flagWithAttributeRule());
    expect(fixture.componentInstance['customKeyOptions']()).toEqual([
      'billingConfigured',
      'oauthGoogleConfigured'
    ]);
  });

  it('previewDraft() reports the unsaved editor state, not the stored flag', async () => {
    const fixture = await setup(flagWithAttributeRule());
    const cmp = fixture.componentInstance;
    expect(cmp.previewDraft()).toEqual({
      rules: [
        {
          effect: 'include',
          type: 'attribute',
          payload: attributeRulePayload
        }
      ],
      enabled: true,
      environments: ['production']
    });

    cmp.removeRule(0);
    cmp.addRule();
    cmp.onEnabledChange(false);
    cmp.onEnvironmentsChange([{ value: 'staging', label: 'staging' }]);

    expect(cmp.previewDraft()).toEqual({
      rules: [
        {
          effect: 'include',
          type: 'percentage',
          payload: { type: 'percentage', percent: 0 }
        }
      ],
      enabled: false,
      environments: ['staging']
    });
  });

  it('submit() skips the confirmation when the flag is disabled', async () => {
    const fixture = await setup({});
    const cmp = fixture.componentInstance;
    cmp.model.set({ key: 'new-dashboard', description: '' });
    cmp.onEnabledChange(false);
    cmp.submit();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
