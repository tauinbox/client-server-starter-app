import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Component, signal, viewChild } from '@angular/core';
import { provideNoopMaterialAnimations } from '../../../../test-utils/material-animations';
import { MAX_LIST_FILTER_LENGTH } from '@app/shared/constants';
import { LIST_SEARCH_DEBOUNCE_MS } from '@shared/utils/pagination.utils';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';
import {
  NxsListFiltersComponent,
  type ListFilterControl
} from './nxs-list-filters.component';

type TestQuery = {
  q?: string;
  enabled?: boolean;
  tag?: string;
  archived?: boolean;
};

const CONTROLS: readonly ListFilterControl<TestQuery>[] = [
  {
    kind: 'select',
    key: 'enabled',
    label: 'common.active',
    allLabel: 'common.all',
    options: [
      { value: true, label: 'common.yes' },
      { value: false, label: 'common.no' }
    ]
  },
  {
    kind: 'select',
    key: 'tag',
    label: 'common.name',
    allLabel: 'common.all',
    options: [{ value: 'beta', label: 'beta', literal: true }]
  },
  { kind: 'checkbox', key: 'archived', label: 'common.delete' }
];

@Component({
  selector: 'nxs-test-host',
  imports: [NxsListFiltersComponent],
  template: `
    <nxs-list-filters
      [value]="value()"
      [controls]="controls"
      (valueChange)="onChange($event)"
    />
  `
})
class TestHostComponent {
  readonly value = signal<TestQuery>({});
  readonly controls = CONTROLS;
  readonly changes: TestQuery[] = [];
  readonly filters = viewChild.required(NxsListFiltersComponent<TestQuery>);

  onChange(next: TestQuery): void {
    this.changes.push(next);
    this.value.set(next);
  }
}

describe('NxsListFiltersComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;

  async function render(initial: TestQuery = {}): Promise<void> {
    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    host.value.set(initial);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /** Types a term and lets the debounce window pass. */
  async function search(term: string): Promise<void> {
    host.filters().searchModel.set({ q: term });
    fixture.detectChanges();
    vi.advanceTimersByTime(LIST_SEARCH_DEBOUNCE_MS);
    await fixture.whenStable();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [TestHostComponent, TranslocoTestingModuleWithLangs],
      providers: [provideNoopMaterialAnimations()]
    }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('search', () => {
    it('emits the trimmed term once the debounce window has passed', async () => {
      await render();

      host.filters().searchModel.set({ q: '  beta ' });
      fixture.detectChanges();
      vi.advanceTimersByTime(LIST_SEARCH_DEBOUNCE_MS - 1);
      expect(host.changes).toEqual([]);

      vi.advanceTimersByTime(1);
      expect(host.changes).toEqual([{ q: 'beta' }]);
    });

    it('sends one request for a burst of typing', async () => {
      await render();

      for (const term of ['b', 'be', 'bet', 'beta']) {
        host.filters().searchModel.set({ q: term });
        fixture.detectChanges();
        vi.advanceTimersByTime(LIST_SEARCH_DEBOUNCE_MS / 2);
      }
      vi.advanceTimersByTime(LIST_SEARCH_DEBOUNCE_MS);

      expect(host.changes).toEqual([{ q: 'beta' }]);
    });

    it('clears q when the box is emptied', async () => {
      await render({ q: 'beta', enabled: true });

      await search('   ');

      expect(host.changes).toEqual([{ q: undefined, enabled: true }]);
    });

    it('starts from the q of the value and emits nothing on its own', async () => {
      await render({ q: 'beta' });
      fixture.detectChanges();
      vi.advanceTimersByTime(LIST_SEARCH_DEBOUNCE_MS);

      expect(host.filters().searchModel()).toEqual({ q: 'beta' });
      expect(host.changes).toEqual([]);
    });

    it('shows a q that the value gets from outside (Back) and emits nothing for it', async () => {
      await render();
      await search('beta');

      host.value.set({ q: 'alpha' });
      fixture.detectChanges();
      vi.advanceTimersByTime(LIST_SEARCH_DEBOUNCE_MS);
      await fixture.whenStable();

      expect(host.filters().searchModel()).toEqual({ q: 'alpha' });
      expect(host.changes).toEqual([{ q: 'beta' }]);
    });

    it('keeps what the user types while the value echoes the last emitted term', async () => {
      await render();
      await search('beta');

      host.filters().searchModel.set({ q: 'beta-2' });
      fixture.detectChanges();

      expect(host.filters().searchModel()).toEqual({ q: 'beta-2' });
    });

    it('does not send a term longer than the cap the API validates', async () => {
      await render();

      await search('x'.repeat(MAX_LIST_FILTER_LENGTH + 1));

      expect(host.changes).toEqual([]);
    });

    it('sends a term exactly at the cap', async () => {
      await render();

      await search('x'.repeat(MAX_LIST_FILTER_LENGTH));

      expect(host.changes).toEqual([{ q: 'x'.repeat(MAX_LIST_FILTER_LENGTH) }]);
    });
  });

  describe('selects', () => {
    it('emits the typed option value at once and keeps the other filters', async () => {
      await render({ q: 'beta' });
      const [enabled] = host.filters().selects();

      host.filters().onSelect(enabled, '1');

      expect(host.changes).toEqual([{ q: 'beta', enabled: false }]);
    });

    it('clears the filter on the "all" option', async () => {
      await render({ enabled: true });
      const [enabled] = host.filters().selects();

      host.filters().onSelect(enabled, '');

      expect(host.changes).toEqual([{ enabled: undefined }]);
    });

    it('shows the option of the current value, and "all" when unset', async () => {
      await render({ enabled: false });
      const [enabled, tag] = host.filters().selects();

      expect(host.filters().selectedIndex(enabled)).toBe('1');
      expect(host.filters().selectedIndex(tag)).toBe('');
    });

    it('renders a literal option label as is', async () => {
      await render();

      expect(host.filters().selects()[1].options[0]).toMatchObject({
        label: 'beta',
        literal: true
      });
    });
  });

  describe('checkboxes', () => {
    it('sets the filter to true when checked and clears it when unchecked', async () => {
      await render();
      const [archived] = host.filters().checkboxes();

      host.filters().onCheck(archived, true);
      fixture.detectChanges();
      host.filters().onCheck(archived, false);

      expect(host.changes).toEqual([
        { archived: true },
        { archived: undefined }
      ]);
    });
  });

  it('emits nothing when a control does not change the value', async () => {
    await render({ enabled: true });
    const [enabled] = host.filters().selects();

    host.filters().onSelect(enabled, '0');

    expect(host.changes).toEqual([]);
  });

  it('renders the search box, one select per select control and the checkbox', async () => {
    await render();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('nxs-form-field input').length).toBe(1);
    expect(element.querySelectorAll('mat-select').length).toBe(2);
    expect(element.querySelectorAll('mat-checkbox').length).toBe(1);
  });
});
