import { effect, Injectable, Signal, signal, WritableSignal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly THEME_KEY = 'preferred-theme';
  private readonly themeSignal: WritableSignal<ThemeMode>;

  readonly theme!: Signal<ThemeMode>

  constructor() {
    const savedTheme = localStorage.getItem(this.THEME_KEY) as ThemeMode;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');

    this.themeSignal = signal<ThemeMode>(initialTheme);
    this.theme = this.themeSignal.asReadonly();

    effect(() => {
      this.applyTheme(this.themeSignal());
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      // Only update if user hasn't explicitly set a preference
      if (!localStorage.getItem(this.THEME_KEY)) {
        this.themeSignal.set(e.matches ? 'dark' : 'light');
      }
    });
  }

  toggleTheme(): void {
    const newTheme = this.themeSignal() === 'light' ? 'dark' : 'light';
    this.themeSignal.set(newTheme);
    localStorage.setItem(this.THEME_KEY, newTheme);
  }

  setTheme(theme: ThemeMode): void {
    this.themeSignal.set(theme);
    localStorage.setItem(this.THEME_KEY, theme);
  }

  private applyTheme(theme: ThemeMode): void {
    document.documentElement.setAttribute('data-theme', theme);

    if (theme === 'dark') {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  }
}
