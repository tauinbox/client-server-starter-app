import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import type { FeatureFlagPreviewResult } from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../../test-utils/transloco-testing';
import { NotifyService } from '@core/services/notify.service';
import { RoleService } from '../../../services/role.service';
import { UserService } from '../../../../users/services/user.service';
import type { User } from '../../../../users/models/user.types';
import { FeatureFlagsAdminService } from '../../../services/feature-flags-admin.service';
import { FeatureFlagPreviewComponent } from './feature-flag-preview.component';

describe('FeatureFlagPreviewComponent', () => {
  let previewSpy: ReturnType<typeof vi.fn>;
  let getAllRolesSpy: ReturnType<typeof vi.fn>;
  let searchUsersSpy: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;

  const setup = async (
    flagId = 'flag-1'
  ): Promise<ComponentFixture<FeatureFlagPreviewComponent>> => {
    previewSpy = vi.fn();
    getAllRolesSpy = vi.fn().mockReturnValue(of([]));
    searchUsersSpy = vi
      .fn()
      .mockReturnValue(
        of({ data: [] as User[], meta: { nextCursor: null as string | null } })
      );
    notifyError = vi.fn();

    await TestBed.configureTestingModule({
      imports: [FeatureFlagPreviewComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        {
          provide: FeatureFlagsAdminService,
          useValue: { preview: previewSpy }
        },
        { provide: RoleService, useValue: { getAll: getAllRolesSpy } },
        { provide: UserService, useValue: { searchCursor: searchUsersSpy } },
        { provide: NotifyService, useValue: { error: notifyError } }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(FeatureFlagPreviewComponent);
    fixture.componentRef.setInput('flagId', flagId);
    fixture.detectChanges();
    return fixture;
  };

  it('loads role options on init', async () => {
    getAllRolesSpy = vi.fn().mockReturnValue(
      of([
        { name: 'admin', description: 'System admins' },
        { name: 'beta', description: null }
      ])
    );
    await TestBed.configureTestingModule({
      imports: [FeatureFlagPreviewComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        { provide: FeatureFlagsAdminService, useValue: { preview: vi.fn() } },
        { provide: RoleService, useValue: { getAll: getAllRolesSpy } },
        {
          provide: UserService,
          useValue: {
            searchCursor: vi.fn().mockReturnValue(
              of({
                data: [] as User[],
                meta: { nextCursor: null as string | null }
              })
            )
          }
        },
        { provide: NotifyService, useValue: { error: vi.fn() } }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(FeatureFlagPreviewComponent);
    fixture.componentRef.setInput('flagId', 'flag-1');
    fixture.detectChanges();
    expect(getAllRolesSpy).toHaveBeenCalledTimes(1);
    expect(
      fixture.componentInstance['roleOptions']().map((c) => c.value)
    ).toEqual(['admin', 'beta']);
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
      'admin.featureFlagPreview.errorPreviewFailed'
    );
    expect(fixture.componentInstance['loading']()).toBe(false);
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
      ]
    ];
    for (const [reason, expected] of cases) {
      expect(cmp['reasonKey'](reason)).toBe(expected);
    }
  });
});
