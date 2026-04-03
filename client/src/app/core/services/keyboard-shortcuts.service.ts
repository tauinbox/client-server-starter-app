import type { Signal } from '@angular/core';
import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal
} from '@angular/core';
import { DOCUMENT } from '@angular/common';

export type ShortcutDef = {
  key: string;
  label: string;
  group: string;
};

type StackEntry = {
  def: ShortcutDef;
  handler: () => void;
};

const INPUT_LIKE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const SAVE_KEYS = new Set(['ctrl+s', 'meta+s']);

@Injectable({
  providedIn: 'root'
})
export class KeyboardShortcutsService {
  readonly #document = inject(DOCUMENT);
  readonly #destroyRef = inject(DestroyRef);

  readonly isMac: boolean = /Mac|iPhone|iPad|iPod/.test(
    this.#document.defaultView?.navigator.platform ?? ''
  );

  readonly #stacks = new Map<string, StackEntry[]>();
  readonly #revision = signal(0);

  readonly shortcuts: Signal<ShortcutDef[]> = computed(() => {
    this.#revision();
    const result: ShortcutDef[] = [];
    for (const stack of this.#stacks.values()) {
      if (stack.length > 0) {
        const top = stack[stack.length - 1].def;
        // Entries with an empty label are blocking no-ops — exclude from help.
        if (top.label) {
          result.push(top);
        }
      }
    }
    return result;
  });

  constructor() {
    const listener = (event: KeyboardEvent) => this.#onKeydown(event);
    this.#document.addEventListener('keydown', listener);
    this.#destroyRef.onDestroy(() =>
      this.#document.removeEventListener('keydown', listener)
    );
  }

  register(
    key: string,
    label: string,
    group: string,
    handler: () => void
  ): () => void {
    const def: ShortcutDef = { key, label, group };
    const entry: StackEntry = { def, handler };

    if (!this.#stacks.has(key)) {
      this.#stacks.set(key, []);
    }
    this.#stacks.get(key)!.push(entry);
    this.#revision.update((v) => v + 1);

    return () => {
      const stack = this.#stacks.get(key);
      if (!stack) return;
      const idx = stack.lastIndexOf(entry);
      if (idx !== -1) {
        stack.splice(idx, 1);
      }
      if (stack.length === 0) {
        this.#stacks.delete(key);
      }
      this.#revision.update((v) => v + 1);
    };
  }

  /**
   * Registers a "save" shortcut using the platform-appropriate modifier:
   * Cmd+S on Mac, Ctrl+S on Windows/Linux.
   */
  registerSave(label: string, group: string, handler: () => void): () => void {
    return this.register(
      this.isMac ? 'meta+s' : 'ctrl+s',
      label,
      group,
      handler
    );
  }

  #onKeydown(event: KeyboardEvent): void {
    const key = this.#normalise(event);
    const isInputTarget = this.#isInputTarget(event);

    if (isInputTarget && !SAVE_KEYS.has(key)) {
      return;
    }

    const stack = this.#stacks.get(key);
    if (!stack || stack.length === 0) return;

    event.preventDefault();
    stack[stack.length - 1].handler();
  }

  #normalise(event: KeyboardEvent): string {
    const parts: string[] = [];
    if (event.ctrlKey) parts.push('ctrl');
    if (event.metaKey) parts.push('meta');
    if (event.shiftKey && event.key !== '?') parts.push('shift');
    if (event.altKey) parts.push('alt');
    parts.push(event.key.toLowerCase());
    return parts.join('+');
  }

  #isInputTarget(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    return INPUT_LIKE_TAGS.has(target.tagName) || target.isContentEditable;
  }
}
