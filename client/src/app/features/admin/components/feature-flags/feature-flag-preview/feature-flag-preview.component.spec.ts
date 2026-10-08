import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopMaterialAnimations } from '../../../../../../test-utils/material-animations';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import type { FeatureFlagPreviewResult } from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../../test-utils/transloco-testing';
import { NotifyService } from '@core/services/notify.service';
import { By } from '@angular/platform-browser';
import { MatSelect } from '@angular/material/select';
import { APP_ENVIRONMENTS } from '@app/shared/constants';
import { NxsChipsAutocompleteComponent } from '@shared/forms/nxs-chips-autocomplete/nxs-chips-autocomplete.component';
import { UserService } from '../../../../users/services/user.service';
import type { User } from '../../../../users/models/user.types';
import { FeatureFlagsAdminService } from '../../../services/feature-flags-admin.service';
import { FeatureFlagPreviewComponent } from './feature-flag-preview.component';

describe('FeatureFlagPreviewComponent', () => {
  let previewSpy: ReturnType<typeof vi.fn>;
  let searchUsersSpy: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;

  const setup = async (
    flagId = 'flag-1'
  ): Promise<ComponentFixture<FeatureFlagPreviewComponent>> => {
    previewSpy = vi.fn();
    searchUsersSpy = vi
      .fn()
      .mockReturnValue(
        of({ data: [] as User[], meta: { nextCursor: null as string | null } })
      );
    notifyError = vi.fn();

    await TestBed.configureTestingModule({
      imports: [FeatureFlagPreviewComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopMaterialAnimations(),
        {
          provide: FeatureFlagsAdminService,
          useValue: { preview: previewSpy }
        },
        { provide: UserService, useValue: { searchCursor: searchUsersSpy } },
        { provide: NotifyService, useValue: { error: notifyError } }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(FeatureFlagPreviewComponent);
    fixture.componentRef.setInput('flagId', flagId);
    fixture.detectChanges();
    return fixture;
  };

  it('offers the roleOptions input in the role picker', async () => {
    const fixture = await setup();
    const roles = [
      { value: 'admin', label: 'admin', sub: 'System admins' },
      { value: 'beta', label: 'beta' }
    ];
    fixture.componentRef.setInput('roleOptions', roles);
    fixture.detectChanges();
    const pickers = fixture.debugElement
      .queryAll(By.directive(NxsChipsAutocompleteComponent))
      .map((el) => el.componentInstance as NxsChipsAutocompleteComponent);
    expect(pickers.some((p) => p.options() === roles)).toBe(true);
  });

  it('builds a structured context from form fields and calls preview()', async () => {
    const fixture = await setup('flag-42');
    previewSpy.mockReturnValue(
      of({
        result: true,
        reason: 'included-by-rule',
        matchedRule: { index: 0, type: 'role', effect: 'include' }
      } satisfies FeatureFlagPreviewResult)
    );
    const cmp = fixture.componentInstance;
    cmp['selectedUser'].set([
      {
        value: '123e4567-e89b-12d3-a456-426614174000',
        label: 'Alice Adams',
        sub: 'alice@example.com'
      }
    ]);
    cmp['selectedRoles'].set([{ value: 'beta', label: 'beta' }]);
    cmp['env'].set('staging');
    cmp.run();
    expect(previewSpy).toHaveBeenCalledWith('flag-42', {
      userId: '123e4567-e89b-12d3-a456-426614174000',
      roles: ['beta'],
      env: 'staging'
    });
    expect(cmp['result']()).toEqual({
      result: true,
      reason: 'included-by-rule',
      matchedRule: { index: 0, type: 'role', effect: 'include' }
    });
  });

  it('offers the server default and only the deployable environments', async () => {
    const fixture = await setup();
    const select = fixture.debugElement.query(By.directive(MatSelect))
      .componentInstance as MatSelect;
    select.open();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(select.options.map((o) => o.value as string)).toEqual([
      '',
      ...APP_ENVIRONMENTS
    ]);
  });

  it('sends the chosen environment and omits the server default', async () => {
    const fixture = await setup();
    previewSpy.mockReturnValue(
      of({
        result: true,
        reason: 'no-rules-default-on',
        matchedRule: null
      } satisfies FeatureFlagPreviewResult)
    );
    const cmp = fixture.componentInstance;
    cmp['env'].set('staging');
    cmp.run();
    cmp['env'].set('');
    cmp.run();
    expect(previewSpy.mock.calls).toEqual([
      ['flag-1', { env: 'staging' }],
      ['flag-1', {}]
    ]);
  });

  it('sends the unsaved draft alongside the context', async () => {
    const fixture = await setup('flag-42');
    previewSpy.mockReturnValue(
      of({
        result: true,
        reason: 'included-by-rule',
        matchedRule: { index: 0, type: 'role', effect: 'include' }
      } satisfies FeatureFlagPreviewResult)
    );
    const draft = {
      rules: [
        {
          type: 'role' as const,
          effect: 'include' as const,
          payload: { type: 'role' as const, roleNames: ['gamma'] }
        }
      ],
      enabled: true,
      environments: ['staging']
    };
    fixture.componentRef.setInput('draft', draft);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp['selectedRoles'].set([{ value: 'gamma', label: 'gamma' }]);
    cmp.run();
    expect(previewSpy).toHaveBeenCalledWith('flag-42', {
      roles: ['gamma'],
      ...draft
    });
  });

  it('sends the draft in raw-JSON mode too', async () => {
    const fixture = await setup('flag-42');
    previewSpy.mockReturnValue(
      of({
        result: false,
        reason: 'disabled',
        matchedRule: null
      } satisfies FeatureFlagPreviewResult)
    );
    fixture.componentRef.setInput('draft', { rules: [], enabled: false });
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.toggleRawJson(true);
    cmp['rawJson'].set('{"roles":["beta"]}');
    cmp.run();
    expect(previewSpy).toHaveBeenCalledWith('flag-42', {
      roles: ['beta'],
      rules: [],
      enabled: false
    });
  });

  it('debounces user search and queries UserService.searchCursor with q', async () => {
    vi.useFakeTimers();
    try {
      const fixture = await setup();
      const cmp = fixture.componentInstance;

      // Below the 3-char threshold — no request.
      cmp.onUserSearchTerm('al');
      vi.advanceTimersByTime(500);
      expect(searchUsersSpy).not.toHaveBeenCalled();

      cmp.onUserSearchTerm('alic');
      vi.advanceTimersByTime(500);
      expect(searchUsersSpy).toHaveBeenCalledTimes(1);
      expect(searchUsersSpy).toHaveBeenCalledWith(
        { q: 'alic' },
        expect.objectContaining({ limit: 10 })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('searches again after a refused user search', async () => {
    vi.useFakeTimers();
    try {
      const fixture = await setup();
      const cmp = fixture.componentInstance;
      const bob: User = {
        id: 'u-bob',
        email: 'bob@example.com',
        firstName: 'Bob',
        lastName: 'Marley',
        isActive: true,
        roles: [],
        isEmailVerified: true,
        hasPassword: true,
        mfaEnabled: false,
        locale: 'en',
        createdAt: '',
        updatedAt: '',
        deletedAt: null
      };
      searchUsersSpy
        .mockReturnValueOnce(
          throwError(() => new HttpErrorResponse({ status: 429 }))
        )
        .mockReturnValueOnce(of({ data: [bob], meta: { nextCursor: null } }));

      cmp.onUserSearchTerm('ann');
      vi.advanceTimersByTime(500);
      cmp.onUserSearchTerm('bob');
      vi.advanceTimersByTime(500);

      expect(searchUsersSpy).toHaveBeenCalledTimes(2);
      expect(cmp['userOptions']().map((c) => c.value)).toEqual(['u-bob']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps user selection to at most one chip (newest wins)', async () => {
    const fixture = await setup();
    const cmp = fixture.componentInstance;
    cmp.onUserChipsChange([
      { value: 'u-1', label: 'Alice' },
      { value: 'u-2', label: 'Bob' }
    ]);
    expect(cmp['selectedUser']()).toEqual([{ value: 'u-2', label: 'Bob' }]);
  });

  it('omits empty fields from the structured context', async () => {
    const fixture = await setup();
    previewSpy.mockReturnValue(
      of({
        result: true,
        reason: 'no-rules-default-on',
        matchedRule: null
      })
    );
    fixture.componentInstance.run();
    expect(previewSpy).toHaveBeenCalledWith('flag-1', {});
  });

  it('parses attributes JSON when provided', async () => {
    const fixture = await setup();
    previewSpy.mockReturnValue(
      of({
        result: false,
        reason: 'excluded',
        matchedRule: { index: 1, type: 'attribute', effect: 'exclude' }
      })
    );
    fixture.componentInstance['attributesJson'].set(
      '{ "email": "x@y.com", "emailDomain": "y.com" }'
    );
    fixture.componentInstance.run();
    expect(previewSpy).toHaveBeenCalledWith('flag-1', {
      attributes: { email: 'x@y.com', emailDomain: 'y.com' }
    });
  });

  it('flags invalid attributes JSON instead of submitting', async () => {
    const fixture = await setup();
    fixture.componentInstance['attributesJson'].set('not-json');
    fixture.componentInstance.run();
    expect(previewSpy).not.toHaveBeenCalled();
    expect(fixture.componentInstance['contextError']()).not.toBeNull();
  });

  it('uses raw-JSON payload when the toggle is on', async () => {
    const fixture = await setup();
    previewSpy.mockReturnValue(
      of({
        result: true,
        reason: 'included-by-rule',
        matchedRule: { index: 0, type: 'user', effect: 'include' }
      })
    );
    fixture.componentInstance.toggleRawJson(true);
    fixture.componentInstance['rawJson'].set(
      '{ "userId": "user-1", "env": "production" }'
    );
    fixture.componentInstance.run();
    expect(previewSpy).toHaveBeenCalledWith('flag-1', {
      userId: 'user-1',
      env: 'production'
    });
  });

  it('shows an error toast when the preview HTTP call fails', async () => {
    const fixture = await setup();
    previewSpy.mockReturnValue(throwError(() => new Error('boom')));
    fixture.componentInstance.run();
    expect(notifyError).toHaveBeenCalledWith(
      'admin.featureFlagPreview.errorPreviewFailed',
      { detail: 'boom' }
    );
    expect(fixture.componentInstance['loading']()).toBe(false);
  });

  it('puts the server rejection text in the error toast', async () => {
    const fixture = await setup();
    previewSpy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { message: 'userId must be a UUID' }
          })
      )
    );

    fixture.componentInstance.run();

    expect(notifyError).toHaveBeenCalledWith(
      'admin.featureFlagPreview.errorPreviewFailed',
      { detail: 'userId must be a UUID' }
    );
  });

  it('maps each preview reason to a stable i18n key', async () => {
    const fixture = await setup();
    const cmp = fixture.componentInstance;
    type Reason = FeatureFlagPreviewResult['reason'];
    const cases: [Reason, string][] = [
      ['disabled', 'admin.featureFlagPreview.reason.disabled'],
      ['env-mismatch', 'admin.featureFlagPreview.reason.envMismatch'],
      ['excluded', 'admin.featureFlagPreview.reason.excluded'],
      ['included-by-rule', 'admin.featureFlagPreview.reason.includedByRule'],
      [
        'no-rules-default-on',
        'admin.featureFlagPreview.reason.noRulesDefaultOn'
      ],
      ['not-included', 'admin.featureFlagPreview.reason.notIncluded']
    ];
    for (const [reason, expected] of cases) {
      expect(cmp['reasonKey'](reason)).toBe(expected);
    }
  });

  it('does not claim an exclusion when no include rule matched', async () => {
    const fixture = await setup();
    previewSpy.mockReturnValue(
      of({
        result: false,
        reason: 'not-included',
        matchedRule: null
      } satisfies FeatureFlagPreviewResult)
    );
    fixture.componentInstance.run();
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector(
      '.preview-result'
    ) as HTMLElement;
    expect(panel.textContent).toContain('No rule included this context');
    expect(panel.textContent).not.toContain('Excluded by rule');
  });

  it('projects the idle play icon into the button leading-icon slot', async () => {
    const fixture = await setup();
    const button = fixture.nativeElement.querySelector(
      '.preview-actions button'
    ) as HTMLElement;
    const icon = button.querySelector('mat-icon') as HTMLElement;
    expect(icon.textContent?.trim()).toBe('play_arrow');
    // The icon must be a direct child of the button so Angular Material projects
    // it into the leading-icon slot. When it is nested inside .mdc-button__label
    // it lands in the default content slot with no icon spacing.
    expect(icon.parentElement).toBe(button);
    expect(icon.closest('.mdc-button__label')).toBeNull();
  });

  it('shows the loading spinner inline in place of the icon while running', async () => {
    const fixture = await setup();
    fixture.componentInstance['loading'].set(true);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      '.preview-actions button'
    ) as HTMLElement;
    expect(button.querySelector('mat-spinner.run-indicator')).not.toBeNull();
    expect(button.querySelector('mat-icon')).toBeNull();
  });
});
