import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslocoTestingModuleWithLangs } from '../../../../../../test-utils/transloco-testing';
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

describe('FeatureFlagRuleRowComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, TranslocoTestingModuleWithLangs],
      providers: [provideNoopAnimations()]
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
});
