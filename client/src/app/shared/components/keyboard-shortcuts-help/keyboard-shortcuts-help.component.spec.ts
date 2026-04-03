import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialogRef } from '@angular/material/dialog';
import { describe, it, expect, vi } from 'vitest';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';
import { KeyboardShortcutsHelpComponent } from './keyboard-shortcuts-help.component';
import type { ShortcutDef } from '@core/services/keyboard-shortcuts.service';
import { KeyboardShortcutsService } from '@core/services/keyboard-shortcuts.service';

function buildMockService(initialShortcuts: ShortcutDef[] = []) {
  const shortcuts = signal<ShortcutDef[]>(initialShortcuts);
  return {
    shortcuts: shortcuts.asReadonly(),
    _set: (value: ShortcutDef[]) => shortcuts.set(value),
    register: vi.fn().mockReturnValue(vi.fn())
  };
}

describe('KeyboardShortcutsHelpComponent', () => {
  let fixture: ComponentFixture<KeyboardShortcutsHelpComponent>;
  let mockService: ReturnType<typeof buildMockService>;

  async function setup(shortcuts: ShortcutDef[] = []) {
    mockService = buildMockService(shortcuts);
    await TestBed.configureTestingModule({
      imports: [
        KeyboardShortcutsHelpComponent,
        TranslocoTestingModuleWithLangs
      ],
      providers: [
        provideNoopAnimations(),
        { provide: KeyboardShortcutsService, useValue: mockService },
        { provide: MatDialogRef, useValue: { close: vi.fn() } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(KeyboardShortcutsHelpComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('renders group headings for each group', async () => {
    await setup([
      {
        key: '?',
        label: 'shortcuts.labelHelp',
        group: 'shortcuts.groupGlobal'
      },
      {
        key: 'ctrl+s',
        label: 'shortcuts.labelSave',
        group: 'shortcuts.groupForms'
      }
    ]);
    const headings = fixture.nativeElement.querySelectorAll('.group-heading');
    expect(headings).toHaveLength(2);
  });

  it('renders translated group names', async () => {
    await setup([
      {
        key: 'ctrl+s',
        label: 'shortcuts.labelSave',
        group: 'shortcuts.groupForms'
      },
      { key: '?', label: 'shortcuts.labelHelp', group: 'shortcuts.groupGlobal' }
    ]);
    const headings = fixture.nativeElement.querySelectorAll('.group-heading');
    expect(headings[0].textContent?.trim()).toBe('Global');
    expect(headings[1].textContent?.trim()).toBe('Forms');
  });

  it('renders key badge per shortcut', async () => {
    await setup([
      {
        key: 'ctrl+s',
        label: 'shortcuts.labelSave',
        group: 'shortcuts.groupForms'
      }
    ]);
    const badge = fixture.nativeElement.querySelector('.key-badge');
    expect(badge?.textContent?.trim()).toBe('ctrl+s');
  });

  it('renders translated label', async () => {
    await setup([
      {
        key: 'ctrl+s',
        label: 'shortcuts.labelSave',
        group: 'shortcuts.groupForms'
      }
    ]);
    const row = fixture.nativeElement.querySelector('td:last-child');
    expect(row?.textContent?.trim()).toBe('Save changes');
  });

  it('shows empty state when no shortcuts', async () => {
    await setup([]);
    const empty = fixture.nativeElement.querySelector('.empty-state');
    expect(empty).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.shortcuts-table')).toBeNull();
  });

  it('reactively re-renders when signal changes', async () => {
    await setup([]);
    expect(fixture.nativeElement.querySelector('.shortcuts-table')).toBeNull();

    mockService._set([
      {
        key: 'ctrl+s',
        label: 'shortcuts.labelSave',
        group: 'shortcuts.groupForms'
      }
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.shortcuts-table')
    ).not.toBeNull();
  });

  it('renders Global group before Forms group', async () => {
    await setup([
      {
        key: 'ctrl+s',
        label: 'shortcuts.labelSave',
        group: 'shortcuts.groupForms'
      },
      { key: '?', label: 'shortcuts.labelHelp', group: 'shortcuts.groupGlobal' }
    ]);
    const headings = fixture.nativeElement.querySelectorAll('.group-heading');
    expect(headings[0].textContent?.trim()).toBe('Global');
    expect(headings[1].textContent?.trim()).toBe('Forms');
  });

  it('close button exists with mat-dialog-close attribute', async () => {
    await setup([]);
    const closeBtn = fixture.nativeElement.querySelector('[mat-dialog-close]');
    expect(closeBtn).not.toBeNull();
  });
});
