import { DOCUMENT } from '@angular/common';
import { effect, inject, Injectable, signal } from '@angular/core';
import { LocalStorageService } from './local-storage.service';

/** Material density range exposed to the user (0 = default, 5 = densest). */
export const DENSITY_MIN = 0;
export const DENSITY_MAX = 5;

const DEFAULT_DENSITY = DENSITY_MIN;
const STORAGE_KEY = 'display-density';

const clampLevel = (level: number): number =>
  Math.min(Math.max(Math.round(level), DENSITY_MIN), DENSITY_MAX);

/**
 * Owns the user's interface-density preference and applies it to the document
 * root. Mirrors {@link ThemeService}: signal-backed, persisted per-device in
 * localStorage, applied through an `effect`.
 *
 * Density is switched at runtime via the `data-ui-density` attribute on
 * `<html>`, whose levels are pre-generated in `styles/themes/_density.scss`
 * (Material density is otherwise a build-time mixin). Overall size is left to
 * the browser's own zoom — this preference only controls layout compactness.
 */
@Injectable({ providedIn: 'root' })
export class DisplayPreferencesService {
  readonly #storage = inject(LocalStorageService);
  readonly #document = inject(DOCUMENT);

  readonly #density = signal(this.#initial());
  readonly density = this.#density.asReadonly();

  constructor() {
    effect(() => this.#apply(this.#density()));
  }

  setDensity(level: number): void {
    const clamped = clampLevel(level);
    this.#density.set(clamped);
    this.#storage.setItem(STORAGE_KEY, clamped);
  }

  #initial(): number {
    const saved = this.#storage.getItem<number>(STORAGE_KEY);
    return typeof saved === 'number' && Number.isFinite(saved)
      ? clampLevel(saved)
      : DEFAULT_DENSITY;
  }

  #apply(level: number): void {
    const root = this.#document.documentElement;
    if (level > 0) {
      root.setAttribute('data-ui-density', String(level));
    } else {
      root.removeAttribute('data-ui-density');
    }
  }
}
