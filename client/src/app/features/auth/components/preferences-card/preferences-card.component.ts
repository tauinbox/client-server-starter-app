import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  linkedSignal,
  output,
  signal
} from '@angular/core';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import {
  MatButtonToggle,
  MatButtonToggleGroup
} from '@angular/material/button-toggle';
import { MatSlider, MatSliderThumb } from '@angular/material/slider';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { HttpErrorResponse } from '@angular/common/http';
import { TranslocoDirective } from '@jsverse/transloco';
import type { UserResponse } from '@app/shared/types';
import { NotifyService } from '@core/services/notify.service';
import { LanguageService } from '@core/services/language.service';
import type { AppLanguage } from '@core/services/language.service';
import {
  DENSITY_MAX,
  DENSITY_MIN,
  DisplayPreferencesService
} from '@core/services/display-preferences.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'nxs-preferences-card',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatSlider,
    MatSliderThumb,
    TranslocoDirective
  ],
  templateUrl: './preferences-card.component.html',
  styleUrl: './preferences-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PreferencesCardComponent {
  readonly #authService = inject(AuthService);
  readonly #notify = inject(NotifyService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #languageService = inject(LanguageService);
  readonly #displayPreferences = inject(DisplayPreferencesService);

  readonly user = input<UserResponse | null>(null);

  /** Keeps the page's copy of the user in step after a locale save. */
  readonly userUpdated = output<UserResponse>();

  protected readonly locale = linkedSignal<AppLanguage>(() =>
    this.user()?.locale === 'ru' ? 'ru' : 'en'
  );
  protected readonly savingLocale = signal(false);

  protected readonly displayDensity = this.#displayPreferences.density;
  protected readonly densityMin = DENSITY_MIN;
  protected readonly densityMax = DENSITY_MAX;

  /**
   * Persists the account's preferred locale (used for server-sent emails) and
   * syncs the live UI language. Persistence is independent of the profile form.
   */
  onLocaleChange(value: AppLanguage): void {
    const previous = this.locale();
    if (value === previous) return;

    this.locale.set(value);
    this.savingLocale.set(true);

    this.#authService
      .updateProfile({ locale: value })
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (updated) => {
          this.savingLocale.set(false);
          this.userUpdated.emit(updated);
          void this.#languageService.setLanguage(value);
          this.#notify.success('auth.profile.languageUpdated');
        },
        error: (err: HttpErrorResponse) => {
          this.savingLocale.set(false);
          this.locale.set(previous);
          this.#notify.error(err, 'auth.profile.errorUpdateFailed');
        }
      });
  }

  onDensityChange(level: number): void {
    this.#displayPreferences.setDensity(level);
  }
}
