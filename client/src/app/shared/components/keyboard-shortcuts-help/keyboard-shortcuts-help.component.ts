import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { TranslocoDirective } from '@jsverse/transloco';
import type { ShortcutDef } from '@core/services/keyboard-shortcuts.service';
import { KeyboardShortcutsService } from '@core/services/keyboard-shortcuts.service';

type ShortcutGroup = {
  group: string;
  shortcuts: ShortcutDef[];
};

const GROUP_ORDER: Record<string, number> = {
  'shortcuts.groupGlobal': 0,
  'shortcuts.groupForms': 1
};

function groupShortcuts(shortcuts: ShortcutDef[]): ShortcutGroup[] {
  const map = new Map<string, ShortcutDef[]>();
  for (const s of shortcuts) {
    if (!map.has(s.group)) {
      map.set(s.group, []);
    }
    map.get(s.group)!.push(s);
  }
  return Array.from(map.entries())
    .map(([group, items]) => ({ group, shortcuts: items }))
    .sort((a, b) => {
      const aOrder = GROUP_ORDER[a.group] ?? 99;
      const bOrder = GROUP_ORDER[b.group] ?? 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.group.localeCompare(b.group);
    });
}

const MAC_SYMBOLS: Record<string, string> = {
  ctrl: 'Ctrl',
  meta: '⌘',
  shift: '⇧',
  alt: '⌥'
};

const WIN_LABELS: Record<string, string> = {
  ctrl: 'Ctrl',
  meta: 'Meta',
  shift: 'Shift',
  alt: 'Alt'
};

@Component({
  selector: 'app-keyboard-shortcuts-help',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, TranslocoDirective],
  templateUrl: './keyboard-shortcuts-help.component.html',
  styleUrl: './keyboard-shortcuts-help.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class KeyboardShortcutsHelpComponent {
  readonly #shortcutsService = inject(KeyboardShortcutsService);

  protected readonly isMac = this.#shortcutsService.isMac;

  protected readonly groupedShortcuts = computed(() =>
    groupShortcuts(this.#shortcutsService.shortcuts())
  );

  protected formatKey(key: string): string {
    const parts = key.split('+');
    const labels = this.isMac ? MAC_SYMBOLS : WIN_LABELS;
    const mapped = parts.map((part) => {
      if (part in labels) return labels[part];
      return /^[a-z]$/.test(part) ? part.toUpperCase() : part;
    });
    // Mac: symbol modifiers join without separator (⌘S, ⌘/)
    // Windows: join with + (Ctrl+S, Ctrl+/)
    const hasMacSymbol =
      this.isMac && mapped.some((p) => ['⌘', '⇧', '⌥'].includes(p));
    return hasMacSymbol ? mapped.join('') : mapped.join('+');
  }
}
