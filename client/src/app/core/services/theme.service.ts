import {
  effect,
  Injectable,
  Signal,
  signal,
  WritableSignal
} from '@angular/core';

export type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'preferred-theme';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly themeSignal: WritableSignal<ThemeMode>;

  readonly theme: Signal<ThemeMode>;

  constructor() {
    const savedTheme = localStorage.getItem(THEME_KEY) as ThemeMode | null;
    const prefersDark = window.matchMedia(
      '(prefers-color-scheme: dark)'
    ).matches;
    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');

    this.themeSignal = signal<ThemeMode>(initialTheme);
    this.theme = this.themeSignal.asReadonly();

    effect(() => {
      this.applyTheme(this.themeSignal());
    });

    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', (e) => {
        // Only update if user hasn't explicitly set a preference
        if (!localStorage.getItem(THEME_KEY)) {
          this.themeSignal.set(e.matches ? 'dark' : 'light');
        }
      });
  }

  toggleTheme(): void {
    const newTheme = this.themeSignal() === 'light' ? 'dark' : 'light';
    this.themeSignal.set(newTheme);
    localStorage.setItem(THEME_KEY, newTheme);
  }

  setTheme(theme: ThemeMode): void {
    this.themeSignal.set(theme);
    localStorage.setItem(THEME_KEY, theme);
  }

  private applyTheme(theme: ThemeMode): void {
    document.documentElement.setAttribute('data-theme', theme);
  }
}
