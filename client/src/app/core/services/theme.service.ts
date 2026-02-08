import { effect, inject, Injectable, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { StorageService } from './storage.service';

export type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'preferred-theme';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  readonly #storage = inject(StorageService);
  readonly #document = inject(DOCUMENT);
  readonly #window = this.#document.defaultView;

  readonly #themeSignal = signal<ThemeMode>(this.#getInitialTheme());
  readonly theme = this.#themeSignal.asReadonly();

  constructor() {
    effect(() => {
      this.#applyTheme(this.#themeSignal());
    });

    this.#window
      ?.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', (e) => {
        if (!this.#storage.getItem(THEME_KEY)) {
          this.#themeSignal.set(e.matches ? 'dark' : 'light');
        }
      });
  }

  toggleTheme(): void {
    const newTheme = this.#themeSignal() === 'light' ? 'dark' : 'light';
    this.#themeSignal.set(newTheme);
    this.#storage.setItem(THEME_KEY, newTheme);
  }

  setTheme(theme: ThemeMode): void {
    this.#themeSignal.set(theme);
    this.#storage.setItem(THEME_KEY, theme);
  }

  #getInitialTheme(): ThemeMode {
    const savedTheme = this.#storage.getItem<ThemeMode>(THEME_KEY);
    const prefersDark =
      this.#window?.matchMedia('(prefers-color-scheme: dark)').matches ?? false;
    return savedTheme || (prefersDark ? 'dark' : 'light');
  }

  #applyTheme(theme: ThemeMode): void {
    this.#document.documentElement.setAttribute('data-theme', theme);
  }
}
