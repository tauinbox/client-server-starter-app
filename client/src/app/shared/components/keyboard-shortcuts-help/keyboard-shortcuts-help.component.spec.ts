import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialogRef } from '@angular/material/dialog';
import { describe, it, expect, vi } from 'vitest';
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

  function setup(shortcuts: ShortcutDef[] = []) {
    mockService = buildMockService(shortcuts);
    TestBed.configureTestingModule({
      imports: [KeyboardShortcutsHelpComponent],
      providers: [
        provideNoopAnimations(),
        { provide: KeyboardShortcutsService, useValue: mockService },
        { provide: MatDialogRef, useValue: { close: vi.fn() } }
      ]
    });
    fixture = TestBed.createComponent(KeyboardShortcutsHelpComponent);
    fixture.detectChanges();
  }

  it('renders group headings for each group', () => {
    setup([
      { key: '?', label: 'Help', group: 'Global' },
      { key: 'ctrl+s', label: 'Save', group: 'Forms' }
    ]);
    const headings = fixture.nativeElement.querySelectorAll('.group-heading');
    expect(headings).toHaveLength(2);
  });

  it('renders key badges and labels', () => {
    setup([{ key: 'ctrl+s', label: 'Save changes', group: 'Forms' }]);
    const badge = fixture.nativeElement.querySelector('.key-badge');
    expect(badge?.textContent?.trim()).toBe('ctrl+s');
    const row = fixture.nativeElement.querySelector('td:last-child');
    expect(row?.textContent?.trim()).toBe('Save changes');
  });

  it('shows empty state when no shortcuts', () => {
    setup([]);
    const empty = fixture.nativeElement.querySelector('.empty-state');
    expect(empty).not.toBeNull();
    const table = fixture.nativeElement.querySelector('.shortcuts-table');
    expect(table).toBeNull();
  });

  it('reactively re-renders when signal changes', () => {
    setup([]);
    expect(fixture.nativeElement.querySelector('.shortcuts-table')).toBeNull();

    mockService._set([{ key: 'ctrl+s', label: 'Save', group: 'Forms' }]);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.shortcuts-table')
    ).not.toBeNull();
  });

  it('renders Global group before Forms group', () => {
    setup([
      { key: 'ctrl+s', label: 'Save', group: 'Forms' },
      { key: '?', label: 'Help', group: 'Global' }
    ]);
    const headings = fixture.nativeElement.querySelectorAll('.group-heading');
    expect(headings[0].textContent?.trim()).toBe('Global');
    expect(headings[1].textContent?.trim()).toBe('Forms');
  });

  it('close button exists with mat-dialog-close attribute', () => {
    setup([]);
    const closeBtn = fixture.nativeElement.querySelector('[mat-dialog-close]');
    expect(closeBtn).not.toBeNull();
  });
});
