import { effect, Injectable, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'preferred-theme';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  readonly #themeSignal = signal<ThemeMode>(this.#getInitialTheme());
  readonly theme = this.#themeSignal.asReadonly();

  constructor() {
    effect(() => {
      this.#applyTheme(this.#themeSignal());
    });

    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', (e) => {
        if (!localStorage.getItem(THEME_KEY)) {
          this.#themeSignal.set(e.matches ? 'dark' : 'light');
        }
      });
  }

  toggleTheme(): void {
    const newTheme = this.#themeSignal() === 'light' ? 'dark' : 'light';
    this.#themeSignal.set(newTheme);
    localStorage.setItem(THEME_KEY, newTheme);
  }

  setTheme(theme: ThemeMode): void {
    this.#themeSignal.set(theme);
    localStorage.setItem(THEME_KEY, theme);
  }

  #getInitialTheme(): ThemeMode {
    const savedTheme = localStorage.getItem(THEME_KEY) as ThemeMode | null;
    const prefersDark = window.matchMedia(
      '(prefers-color-scheme: dark)'
    ).matches;
    return savedTheme || (prefersDark ? 'dark' : 'light');
  }

  #applyTheme(theme: ThemeMode): void {
    document.documentElement.setAttribute('data-theme', theme);
  }
}
