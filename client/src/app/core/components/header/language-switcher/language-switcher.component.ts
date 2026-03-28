import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslocoDirective } from '@jsverse/transloco';
import type { AppLanguage } from '@core/services/language.service';
import { LanguageService } from '@core/services/language.service';

type LanguageOption = {
  code: AppLanguage;
  label: string;
  flag: string;
};

const LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English', flag: 'flag-en' },
  { code: 'ru', label: 'Русский', flag: 'flag-ru' }
];

@Component({
  selector: 'app-language-switcher',
  imports: [
    MatIconButton,
    MatIcon,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatTooltip,
    TranslocoDirective
  ],
  templateUrl: './language-switcher.component.html',
  styleUrl: './language-switcher.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LanguageSwitcherComponent {
  readonly #languageService = inject(LanguageService);
  protected readonly language = this.#languageService.language;
  protected readonly languages = LANGUAGES;

  protected get currentFlag(): string {
    return LANGUAGES.find((l) => l.code === this.language())?.flag ?? 'flag-en';
  }

  protected switchLanguage(lang: AppLanguage): void {
    this.#languageService.setLanguage(lang);
  }
}
