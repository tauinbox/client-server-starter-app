import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNativeDateAdapter } from '@angular/material/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { TranslocoTestingModuleWithLangs } from '../../../../../../test-utils/transloco-testing';
import { RoleService } from '../../../services/role.service';
import { UserService } from '../../../../users/services/user.service';
import type { User } from '../../../../users/models/user.types';
import type { FeatureFlagRuleDraft } from './feature-flag-rule-row.component';
import { FeatureFlagRuleRowComponent } from './feature-flag-rule-row.component';

@Component({
  imports: [FeatureFlagRuleRowComponent],
  template: `<nxs-feature-flag-rule-row
    [(rule)]="rule"
    (remove)="onRemove()"
  />`
})
class HostComponent {
  readonly rule = signal<FeatureFlagRuleDraft>({
    effect: 'include',
    type: 'percentage',
    payload: { type: 'percentage', percent: 25 }
  });
  removed = 0;
  onRemove(): void {
    this.removed++;
  }
}

const roleServiceStub = {
  getAll: vi.fn(() =>
    of([
      {
        id: 'r1',
        name: 'beta-tester',
        description: 'beta program members',
        isSystem: false,
        isSuper: false,
        createdAt: '',
        updatedAt: ''
      },
      {
        id: 'r2',
        name: 'admin',
        description: null,
        isSystem: true,
        isSuper: false,
        createdAt: '',
        updatedAt: ''
      }
    ])
  )
};

const userServiceStub: {
  searchCursor: ReturnType<typeof vi.fn>;
  getById: ReturnType<typeof vi.fn>;
} = {
  searchCursor: vi.fn(() =>
    of({ data: [] as User[], meta: { nextCursor: null as string | null } })
  ),
  getById: vi.fn(() => of(null))
};

describe('FeatureFlagRuleRowComponent', () => {
  beforeEach(async () => {
    roleServiceStub.getAll.mockClear();
    userServiceStub.searchCursor.mockClear();
    userServiceStub.getById.mockClear();
    await TestBed.configureTestingModule({
      imports: [HostComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        provideNativeDateAdapter(),
        { provide: RoleService, useValue: roleServiceStub },
        { provide: UserService, useValue: userServiceStub }
      ]
    }).compileComponents();
  });

  it('renders the percentage payload editor by default', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const sliderInput = (fixture.nativeElement as HTMLElement).querySelector(
      'input[matSliderThumb]'
    );
    expect(sliderInput).not.toBeNull();
  });

  it('shows a static percent label that mirrors the slider value', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const label = (fixture.nativeElement as HTMLElement).querySelector(
      '.rule-percent-value'
    );
    expect(label?.textContent?.trim()).toBe('25%');
  });

  it('drops the redundant number-input form-field from the percentage editor', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const numberInput = (fixture.nativeElement as HTMLElement).querySelector(
      '.rule-percent-input'
    );
    expect(numberInput).toBeNull();
  });

  it('snaps percent change to the nearest multiple of 5', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const cmp = fixture.debugElement.children[0]
      .componentInstance as FeatureFlagRuleRowComponent;

    cmp.onPercentChange(47);
    expect(fixture.componentInstance.rule().payload).toEqual({
      type: 'percentage',
      percent: 45
    });

    cmp.onPercentChange(48);
    expect(fixture.componentInstance.rule().payload).toEqual({
      type: 'percentage',
      percent: 50
    });

    cmp.onPercentChange(102);
    expect(fixture.componentInstance.rule().payload).toEqual({
      type: 'percentage',
      percent: 100
    });

    cmp.onPercentChange(-5);
    expect(fixture.componentInstance.rule().payload).toEqual({
      type: 'percentage',
      percent: 0
    });
  });

  it('reflects rule effect on the root .rule-row via data-effect', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const row = (fixture.nativeElement as HTMLElement).querySelector(
      '.rule-row'
    );
    expect(row?.getAttribute('data-effect')).toBe('include');

    fixture.componentInstance.rule.set({
      ...fixture.componentInstance.rule(),
      effect: 'exclude'
    });
    fixture.detectChanges();
    expect(row?.getAttribute('data-effect')).toBe('exclude');
  });

  it('every <mat-form-field> in the row uses subscriptSizing="dynamic"', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.rule.set({
      effect: 'include',
      type: 'attribute',
      payload: {
        type: 'attribute',
        field: 'custom',
        op: 'eq',
        value: '',
        customKey: 'plan'
      }
    });
    fixture.detectChanges();
    const fields = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'mat-form-field'
    );
    expect(fields.length).toBeGreaterThan(0);
    for (const field of Array.from(fields)) {
      const subscript = field.querySelector(
        '.mat-mdc-form-field-subscript-wrapper'
      );
      expect(subscript).not.toBeNull();
      expect(
        subscript!.classList.contains(
          'mat-mdc-form-field-subscript-dynamic-size'
        )
      ).toBe(true);
    }
  });

  it('emits remove when the trash button is clicked', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const removeBtn = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>('button.rule-remove');
    expect(removeBtn).not.toBeNull();
    removeBtn?.click();
    expect(fixture.componentInstance.removed).toBe(1);
  });

  it('switching type rebuilds the payload with a default for the new type', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const rowDebug = fixture.debugElement.children[0];
    const rowInstance =
      rowDebug.componentInstance as FeatureFlagRuleRowComponent;

    rowInstance.onTypeChange('user');
    fixture.detectChanges();
    expect(fixture.componentInstance.rule().payload).toEqual({
      type: 'user',
      userIds: []
    });

    rowInstance.onTypeChange('attribute');
    fixture.detectChanges();
    expect(fixture.componentInstance.rule().payload).toEqual({
      type: 'attribute',
      field: 'email',
      op: 'eq',
      value: ''
    });
  });

  it('preloads user labels via getById when opening a user-rule with existing IDs', () => {
    userServiceStub.getById.mockImplementation((id: string) =>
      of({
        id,
        firstName: 'Alice',
        lastName: 'Adams',
        email: `alice+${id}@example.com`
      } as Partial<User>)
    );
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.rule.set({
      effect: 'include',
      type: 'user',
      payload: { type: 'user', userIds: ['uuid-1', 'uuid-2'] }
    });
    fixture.detectChanges();
    expect(userServiceStub.getById).toHaveBeenCalledTimes(2);
    expect(userServiceStub.getById).toHaveBeenCalledWith('uuid-1');
    expect(userServiceStub.getById).toHaveBeenCalledWith('uuid-2');

    const chipLabels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('mat-chip-row')
    ).map((el) => el.textContent?.trim());
    // Each chip should now display the user's name, not the raw UUID.
    expect(chipLabels.some((t) => t?.includes('Alice Adams'))).toBe(true);
  });

  it('does not fetch user details for non-user rule types', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.rule.set({
      effect: 'include',
      type: 'role',
      payload: { type: 'role', roleNames: ['admin'] }
    });
    fixture.detectChanges();
    expect(userServiceStub.getById).not.toHaveBeenCalled();
  });

  it('skips getById when payload.userIds is empty', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.rule.set({
      effect: 'include',
      type: 'user',
      payload: { type: 'user', userIds: [] }
    });
    fixture.detectChanges();
    expect(userServiceStub.getById).not.toHaveBeenCalled();
  });

  it('falls back to UUID label when getById fails for an unknown user', () => {
    userServiceStub.getById.mockImplementation((id: string) =>
      id === 'uuid-known'
        ? of({
            id,
            firstName: 'Carol',
            lastName: 'Clark',
            email: 'carol@example.com'
          } as Partial<User>)
        : throwError(() => new Error('not found'))
    );
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.rule.set({
      effect: 'include',
      type: 'user',
      payload: { type: 'user', userIds: ['uuid-known', 'uuid-missing'] }
    });
    expect(() => fixture.detectChanges()).not.toThrow();
    const chipLabels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('mat-chip-row')
    ).map((el) => el.textContent?.trim());
    expect(chipLabels.some((t) => t?.includes('Carol Clark'))).toBe(true);
    expect(chipLabels.some((t) => t?.includes('uuid-missing'))).toBe(true);
  });

  it('user chip change writes UUIDs (not labels) into payload.userIds', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.rule.set({
      effect: 'include',
      type: 'user',
      payload: { type: 'user', userIds: [] }
    });
    fixture.detectChanges();
    const cmp = fixture.debugElement.children[0]
      .componentInstance as FeatureFlagRuleRowComponent;
    cmp.onUserChipsChange([
      { value: 'uuid-1', label: 'Alice — alice@example.com' },
      { value: 'uuid-2', label: 'Bob — bob@example.com' }
    ]);
    expect(fixture.componentInstance.rule().payload).toEqual({
      type: 'user',
      userIds: ['uuid-1', 'uuid-2']
    });
  });

  it('role chip change writes role names into payload.roleNames', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.rule.set({
      effect: 'include',
      type: 'role',
      payload: { type: 'role', roleNames: [] }
    });
    fixture.detectChanges();
    const cmp = fixture.debugElement.children[0]
      .componentInstance as FeatureFlagRuleRowComponent;
    cmp.onRoleChipsChange([
      { value: 'beta-tester', label: 'beta-tester' },
      { value: 'admin', label: 'admin' }
    ]);
    expect(fixture.componentInstance.rule().payload).toEqual({
      type: 'role',
      roleNames: ['beta-tester', 'admin']
    });
  });

  it('renders a datepicker for attribute op=before', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.rule.set({
      effect: 'include',
      type: 'attribute',
      payload: {
        type: 'attribute',
        field: 'createdAt',
        op: 'before',
        value: ''
      }
    });
    fixture.detectChanges();
    const toggle = (fixture.nativeElement as HTMLElement).querySelector(
      'mat-datepicker-toggle'
    );
    expect(toggle).not.toBeNull();
    const dateInput = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLInputElement>('input[matInput]');
    expect(dateInput).not.toBeNull();
  });

  it('renders a datepicker for attribute op=after', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.rule.set({
      effect: 'include',
      type: 'attribute',
      payload: {
        type: 'attribute',
        field: 'createdAt',
        op: 'after',
        value: ''
      }
    });
    fixture.detectChanges();
    const toggle = (fixture.nativeElement as HTMLElement).querySelector(
      'mat-datepicker-toggle'
    );
    expect(toggle).not.toBeNull();
  });

  it('onAttributeDateChange writes ISO string to payload.value', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.rule.set({
      effect: 'include',
      type: 'attribute',
      payload: {
        type: 'attribute',
        field: 'createdAt',
        op: 'after',
        value: ''
      }
    });
    fixture.detectChanges();
    const cmp = fixture.debugElement.children[0]
      .componentInstance as FeatureFlagRuleRowComponent;

    const d = new Date(Date.UTC(2026, 0, 15, 0, 0, 0));
    cmp.onAttributeDateChange(d);
    expect(fixture.componentInstance.rule().payload).toEqual({
      type: 'attribute',
      field: 'createdAt',
      op: 'after',
      value: d.toISOString()
    });
  });

  it('onAttributeDateChange with null blanks payload.value', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.rule.set({
      effect: 'include',
      type: 'attribute',
      payload: {
        type: 'attribute',
        field: 'createdAt',
        op: 'before',
        value: '2026-01-15T00:00:00.000Z'
      }
    });
    fixture.detectChanges();
    const cmp = fixture.debugElement.children[0]
      .componentInstance as FeatureFlagRuleRowComponent;
    cmp.onAttributeDateChange(null);
    expect(fixture.componentInstance.rule().payload).toEqual({
      type: 'attribute',
      field: 'createdAt',
      op: 'before',
      value: ''
    });
  });

  it('keeps a plain text input for attribute op=eq', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.rule.set({
      effect: 'include',
      type: 'attribute',
      payload: {
        type: 'attribute',
        field: 'email',
        op: 'eq',
        value: 'demo@example.com'
      }
    });
    fixture.detectChanges();
    const toggle = (fixture.nativeElement as HTMLElement).querySelector(
      'mat-datepicker-toggle'
    );
    expect(toggle).toBeNull();
  });

  it('attribute op=in stores chip array as payload.value', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.rule.set({
      effect: 'include',
      type: 'attribute',
      payload: { type: 'attribute', field: 'email', op: 'in', value: [] }
    });
    fixture.detectChanges();
    const cmp = fixture.debugElement.children[0]
      .componentInstance as FeatureFlagRuleRowComponent;
    cmp.onAttributeChipsChange([
      { value: 'a@x.com', label: 'a@x.com' },
      { value: 'b@x.com', label: 'b@x.com' }
    ]);
    expect(fixture.componentInstance.rule().payload).toEqual({
      type: 'attribute',
      field: 'email',
      op: 'in',
      value: ['a@x.com', 'b@x.com']
    });
  });

  it('switching attribute op from in to eq collapses chip array to a scalar', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.rule.set({
      effect: 'include',
      type: 'attribute',
      payload: {
        type: 'attribute',
        field: 'email',
        op: 'in',
        value: ['a@x.com', 'b@x.com']
      }
    });
    fixture.detectChanges();
    const cmp = fixture.debugElement.children[0]
      .componentInstance as FeatureFlagRuleRowComponent;
    cmp.onAttributeOpChange('eq');
    expect(fixture.componentInstance.rule().payload).toEqual({
      type: 'attribute',
      field: 'email',
      op: 'eq',
      value: 'a@x.com'
    });
  });

  it('loads roles into the autocomplete options on init', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(roleServiceStub.getAll).toHaveBeenCalledTimes(1);
  });

  it('user search debounces and issues a single request with unified q', async () => {
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(HostComponent);
      fixture.componentInstance.rule.set({
        effect: 'include',
        type: 'user',
        payload: { type: 'user', userIds: [] }
      });
      fixture.detectChanges();
      const cmp = fixture.debugElement.children[0]
        .componentInstance as FeatureFlagRuleRowComponent;

      cmp.onUserSearchTerm('use');
      cmp.onUserSearchTerm('user');
      cmp.onUserSearchTerm('users');
      vi.advanceTimersByTime(400);

      expect(userServiceStub.searchCursor).toHaveBeenCalledTimes(1);
      expect(userServiceStub.searchCursor).toHaveBeenCalledWith(
        { q: 'users' },
        expect.objectContaining({
          limit: 10,
          sortBy: 'createdAt',
          sortOrder: 'desc'
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips user search when term is shorter than the min-chars threshold', async () => {
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(HostComponent);
      fixture.componentInstance.rule.set({
        effect: 'include',
        type: 'user',
        payload: { type: 'user', userIds: [] }
      });
      fixture.detectChanges();
      const cmp = fixture.debugElement.children[0]
        .componentInstance as FeatureFlagRuleRowComponent;

      cmp.onUserSearchTerm('ab');
      vi.advanceTimersByTime(400);

      expect(userServiceStub.searchCursor).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips the network when narrowing within a complete previous result set', async () => {
    vi.useFakeTimers();
    try {
      const alice: User = {
        id: '11111111-1111-1111-1111-111111111111',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Wonder',
        isActive: true,
        roles: [],
        isEmailVerified: true,
        locale: 'en',
        createdAt: '',
        updatedAt: '',
        deletedAt: null
      };
      const bob: User = {
        id: '22222222-2222-2222-2222-222222222222',
        email: 'bob@example.com',
        firstName: 'Bob',
        lastName: 'Marley',
        isActive: true,
        roles: [],
        isEmailVerified: true,
        locale: 'en',
        createdAt: '',
        updatedAt: '',
        deletedAt: null
      };
      userServiceStub.searchCursor.mockReturnValueOnce(
        of({ data: [alice, bob], meta: { nextCursor: null } })
      );

      const fixture = TestBed.createComponent(HostComponent);
      fixture.componentInstance.rule.set({
        effect: 'include',
        type: 'user',
        payload: { type: 'user', userIds: [] }
      });
      fixture.detectChanges();
      const cmp = fixture.debugElement.children[0]
        .componentInstance as FeatureFlagRuleRowComponent;

      cmp.onUserSearchTerm('ali');
      vi.advanceTimersByTime(400);
      expect(userServiceStub.searchCursor).toHaveBeenCalledTimes(1);

      cmp.onUserSearchTerm('alic');
      vi.advanceTimersByTime(400);
      cmp.onUserSearchTerm('alice');
      vi.advanceTimersByTime(400);

      // Narrowing within the cached complete result set must NOT hit
      // the network — prevents the throttler-triggering request burst
      // that occurred before the prefix-cache existed.
      expect(userServiceStub.searchCursor).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
