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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, switchMap } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import { form, required } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  ErrorKeys,
  OAUTH_ERROR,
  type CountryCode,
  type DataRegion,
  type OAuthError
} from '@app/shared/constants';
import { RegionConfigService } from '@core/services/region-config.service';
import { parseHttpErrorMessage } from '@shared/utils/http-error.utils';
import { LegalLinksComponent } from '@features/legal/components/legal-links/legal-links.component';
import { AuthService } from '../../services/auth.service';
import { AuthStore } from '../../store/auth.store';
import { presetResidenceCountry } from '../../utils/residence-country';
import { ResidenceCountryFieldComponent } from '../residence-country-field/residence-country-field.component';

/** The refusals after which this sign-up cannot go on: it restarts at /login. */
const RESTART_ERRORS: Partial<Record<string, OAuthError>> = {
  [ErrorKeys.AUTH.MISSING_OAUTH_DATA]: OAUTH_ERROR.AUTH_FAILED,
  [ErrorKeys.AUTH.INVALID_OAUTH_DATA]: OAUTH_ERROR.AUTH_FAILED,
  [ErrorKeys.USERS.EMAIL_EXISTS]: OAUTH_ERROR.EMAIL_ALREADY_REGISTERED
};

/** A sign-up whose account belongs to the pool of another region. */
export type ResidenceRegionMove = {
  region: DataRegion;
  residenceCountry: CountryCode;
};

/**
 * The country of residence of a provider identity that no account holds. The
 * account is created only when the user declares it, because the country
 * decides which pool may keep the personal data. The provider profile waits
 * in a host-only cookie of the API host that started the round trip, so a
 * country of another region starts the round trip again on its host.
 */
@Component({
  selector: 'nxs-oauth-residence',
  imports: [
    MatButton,
    MatProgressSpinner,
    LegalLinksComponent,
    ResidenceCountryFieldComponent,
    TranslocoDirective
  ],
  templateUrl: './oauth-residence.component.html',
  styleUrl: './oauth-residence.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OAuthResidenceComponent {
  readonly #authService = inject(AuthService);
  readonly #authStore = inject(AuthStore);
  readonly #regionConfig = inject(RegionConfigService);
  readonly #translocoService = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);

  /** The country that the user declared before the round trip started again. */
  readonly declaredCountry = input<CountryCode | null>(null);

  /** The account exists and the session is saved. */
  readonly completed = output();
  readonly cancelled = output();
  /** The sign-up cannot go on; the value is the reason for /login. */
  readonly failed = output<OAuthError>();
  /** The account belongs to the pool of another region. */
  readonly regionMoved = output<ResidenceRegionMove>();

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly peerUrl = signal<string | null>(null);
  protected readonly legalKinds = ['terms', 'privacy'] as const;

  readonly residenceModel = linkedSignal<{
    residenceCountry: CountryCode | '';
  }>(() => ({
    residenceCountry:
      this.declaredCountry() ?? presetResidenceCountry(navigator.languages)
  }));

  readonly residenceForm = form(this.residenceModel, (path) => {
    required(path.residenceCountry, {
      message: 'auth.register.residenceCountryRequired'
    });
  });

  protected canSubmit(): boolean {
    return !this.residenceForm().invalid() && !this.loading();
  }

  onSubmit(): void {
    const { residenceCountry } = this.residenceModel();

    if (!this.canSubmit() || !residenceCountry) return;

    this.loading.set(true);
    this.error.set(null);
    this.peerUrl.set(null);

    this.#regionConfig
      .registrationRegion(residenceCountry)
      .pipe(
        switchMap((region) => {
          if (region !== this.#authStore.region()) {
            this.regionMoved.emit({ region, residenceCountry });

            return EMPTY;
          }

          return this.#authService.completeOAuthSignup(residenceCountry);
        }),
        takeUntilDestroyed(this.#destroyRef)
      )
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.completed.emit();
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          const errorKey = err.error?.errorKey as string | undefined;
          const restart = errorKey ? RESTART_ERRORS[errorKey] : undefined;

          if (restart) {
            this.failed.emit(restart);

            return;
          }

          this.#regionConfig
            .peerUrl(residenceCountry, errorKey)
            .pipe(takeUntilDestroyed(this.#destroyRef))
            .subscribe((url) => this.peerUrl.set(url));

          this.error.set(
            parseHttpErrorMessage(
              err,
              this.#translocoService,
              'auth.oauthResidence.errorFailed'
            )
          );
        }
      });
  }
}
