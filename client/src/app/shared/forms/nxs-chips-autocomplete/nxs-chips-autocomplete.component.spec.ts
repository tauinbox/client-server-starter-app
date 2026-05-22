import { Component, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';
import type { ChipOption } from './nxs-chips-autocomplete.component';
import { ChipsAutocompleteComponent } from './nxs-chips-autocomplete.component';

@Component({
  imports: [ChipsAutocompleteComponent],
  template: `<nxs-chips-autocomplete
    [selected]="selected()"
    [options]="options()"
    [allowFreeText]="allowFreeText"
    label="featureFlagRule.users"
    placeholder="featureFlagRule.users"
    (selectedChange)="onSelected($event)"
    (searchTermChange)="onTerm($event)"
  />`
})
class HostComponent {
  readonly selected = signal<ChipOption[]>([]);
  readonly options = signal<ChipOption[]>([]);
  allowFreeText = false;
  lastEmitted: ChipOption[] | null = null;
  lastTerm: string | null = null;
  onSelected(next: ChipOption[]): void {
    this.lastEmitted = next;
    this.selected.set(next);
  }
  onTerm(term: string): void {
    this.lastTerm = term;
  }
}

function getInput(fixture: ComponentFixture<HostComponent>): HTMLInputElement {
  const el = (fixture.nativeElement as HTMLElement).querySelector('input');
  if (!el) throw new Error('chip input not found');
  return el as HTMLInputElement;
}

function getChipTexts(fixture: ComponentFixture<HostComponent>): string[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('mat-chip-row')
  ).map((c) => c.textContent?.trim().replace(/\s*cancel\s*$/i, '') ?? '');
}

describe('ChipsAutocompleteComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, TranslocoTestingModuleWithLangs],
      providers: [provideNoopAnimations()]
    }).compileComponents();
  });

  it('renders the chips passed via [selected]', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.selected.set([
      { value: 'production', label: 'production' },
      { value: 'staging', label: 'staging' }
    ]);
    fixture.detectChanges();
    expect(getChipTexts(fixture)).toEqual(['production', 'staging']);
  });

  it('emits selectedChange with a new chip on free-text Enter when allowFreeText=true', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.allowFreeText = true;
    fixture.detectChanges();

    const cmp = fixture.debugElement.children[0]
      .componentInstance as ChipsAutocompleteComponent;
    cmp['addFromTokenEnd']({
      value: 'qa-eu',
      input: null,
      chipInput: null
    } as unknown as Parameters<(typeof cmp)['addFromTokenEnd']>[0]);

    expect(fixture.componentInstance.lastEmitted).toEqual([
      { value: 'qa-eu', label: 'qa-eu' }
    ]);
  });

  it('ignores free-text Enter when allowFreeText=false', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.allowFreeText = false;
    fixture.detectChanges();

    const cmp = fixture.debugElement.children[0]
      .componentInstance as ChipsAutocompleteComponent;
    cmp['addFromTokenEnd']({
      value: 'qa-eu',
      input: null,
      chipInput: null
    } as unknown as Parameters<(typeof cmp)['addFromTokenEnd']>[0]);

    expect(fixture.componentInstance.lastEmitted).toBeNull();
  });

  it('does not add a duplicate chip', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.allowFreeText = true;
    fixture.componentInstance.selected.set([
      { value: 'production', label: 'production' }
    ]);
    fixture.detectChanges();

    const cmp = fixture.debugElement.children[0]
      .componentInstance as ChipsAutocompleteComponent;
    cmp['addFromTokenEnd']({
      value: 'production',
      input: null,
      chipInput: null
    } as unknown as Parameters<(typeof cmp)['addFromTokenEnd']>[0]);

    expect(fixture.componentInstance.lastEmitted).toBeNull();
  });

  it('emits selectedChange without the removed chip', () => {
    const fixture = TestBed.createComponent(HostComponent);
    const chip: ChipOption = { value: 'production', label: 'production' };
    fixture.componentInstance.selected.set([
      chip,
      { value: 'staging', label: 'staging' }
    ]);
    fixture.detectChanges();

    const cmp = fixture.debugElement.children[0]
      .componentInstance as ChipsAutocompleteComponent;
    cmp['removeChip'](chip);

    expect(fixture.componentInstance.lastEmitted).toEqual([
      { value: 'staging', label: 'staging' }
    ]);
  });

  it('filters autocomplete options by typed term and excludes already-selected', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.options.set([
      { value: 'production', label: 'production' },
      { value: 'staging', label: 'staging' },
      { value: 'development', label: 'development' }
    ]);
    fixture.componentInstance.selected.set([
      { value: 'staging', label: 'staging' }
    ]);
    fixture.detectChanges();

    const cmp = fixture.debugElement.children[0]
      .componentInstance as ChipsAutocompleteComponent;
    cmp['inputValue'].set('prod');
    expect(cmp['filteredOptions']().map((o) => o.value)).toEqual([
      'production'
    ]);

    cmp['inputValue'].set('');
    expect(cmp['filteredOptions']().map((o) => o.value)).toEqual([
      'production',
      'development'
    ]);
  });

  it('emits searchTermChange when the user types', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const input = getInput(fixture);
    input.value = 'jo';
    input.dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.lastTerm).toBe('jo');
  });
});
