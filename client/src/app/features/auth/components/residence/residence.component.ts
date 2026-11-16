import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { form, required } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { ErrorKeys, type CountryCode } from '@app/shared/constants';
import { RegionConfigService } from '@core/services/region-config.service';
import { parseHttpErrorMessage } from '@shared/utils/http-error.utils';
import { AuthService } from '../../services/auth.service';
import { presetResidenceCountry } from '../../utils/residence-country';
import { afterResidenceUrl } from '../../utils/residence-redirect';
import { ResidenceCountryFieldComponent } from '../residence-country-field/residence-country-field.component';

/**
 * The one declaration of the country of residence of an account that has
 * none. The guards send such an account here before any other page; a
 * refused country leaves it here to choose again or to sign out.
 */
@Component({
  selector: 'nxs-residence',
  imports: [
    MatButton,
    MatCardModule,
    MatProgressSpinner,
    ResidenceCountryFieldComponent,
    TranslocoDirective
  ],
  templateUrl: './residence.component.html',
  styleUrl: './residence.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResidenceComponent {
  readonly #authService = inject(AuthService);
  readonly #regionConfig = inject(RegionConfigService);
  readonly #translocoService = inject(TranslocoService);
  readonly #router = inject(Router);
  readonly #route = inject(ActivatedRoute);
  readonly #window = inject(DOCUMENT).defaultView;
  readonly #destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly peerUrl = signal<string | null>(null);

  readonly residenceModel = signal<{ residenceCountry: CountryCode | '' }>({
    residenceCountry: presetResidenceCountry(navigator.languages)
  });

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

    this.#authService
      .declareResidence(residenceCountry)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => this.#continue(),
        error: (err: HttpErrorResponse) => {
          const errorKey = err.error?.errorKey as string | undefined;

          // Another tab declared it first: the account owes nothing now.
          if (errorKey === ErrorKeys.AUTH.RESIDENCE_ALREADY_DECLARED) {
            this.#authService
              .getProfile()
              .pipe(takeUntilDestroyed(this.#destroyRef))
              .subscribe({
                next: () => this.#continue(),
                error: () => this.#showError(err)
              });

            return;
          }

          this.#regionConfig
            .peerUrl(residenceCountry, errorKey)
            .pipe(takeUntilDestroyed(this.#destroyRef))
            .subscribe((url) => this.peerUrl.set(url));

          this.#showError(err);
        }
      });
  }

  onSignOut(): void {
    this.#authService.logout();
  }

  #continue(): void {
    void this.#router.navigateByUrl(
      afterResidenceUrl(
        this.#route.snapshot.queryParamMap.get('returnUrl'),
        this.#window?.location.origin
      )
    );
  }

  #showError(err: HttpErrorResponse): void {
    this.loading.set(false);
    this.error.set(
      parseHttpErrorMessage(
        err,
        this.#translocoService,
        'auth.residence.errorFailed'
      )
    );
  }
}
