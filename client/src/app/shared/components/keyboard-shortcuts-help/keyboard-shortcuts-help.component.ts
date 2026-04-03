import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import type { ShortcutDef } from '@core/services/keyboard-shortcuts.service';
import { KeyboardShortcutsService } from '@core/services/keyboard-shortcuts.service';

type ShortcutGroup = {
  group: string;
  shortcuts: ShortcutDef[];
};

const GROUP_ORDER: Record<string, number> = {
  Global: 0,
  Forms: 1
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

@Component({
  selector: 'app-keyboard-shortcuts-help',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule],
  templateUrl: './keyboard-shortcuts-help.component.html',
  styleUrl: './keyboard-shortcuts-help.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class KeyboardShortcutsHelpComponent {
  readonly #shortcutsService = inject(KeyboardShortcutsService);

  protected readonly groupedShortcuts = computed(() =>
    groupShortcuts(this.#shortcutsService.shortcuts())
  );
}
