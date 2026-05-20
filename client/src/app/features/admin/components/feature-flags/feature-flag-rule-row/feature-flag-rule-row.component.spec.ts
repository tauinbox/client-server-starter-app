import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { TranslocoTestingModuleWithLangs } from '../../../../../../test-utils/transloco-testing';
import { RoleService } from '../../../services/role.service';
import { UserService } from '../../../../users/services/user.service';
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

const userServiceStub = {
  searchCursor: vi.fn(() => of({ data: [], meta: { nextCursor: null } }))
};

describe('FeatureFlagRuleRowComponent', () => {
  beforeEach(async () => {
    roleServiceStub.getAll.mockClear();
    userServiceStub.searchCursor.mockClear();
    await TestBed.configureTestingModule({
      imports: [HostComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
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
});
