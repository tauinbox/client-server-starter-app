import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import type { HttpErrorResponse } from '@angular/common/http';
import { form, required } from '@angular/forms/signals';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { CountryCode } from '@app/shared/constants';
import type { UserResponse } from '@app/shared/types';
import { NotifyService } from '@core/services/notify.service';
import { RegionConfigService } from '@core/services/region-config.service';
import { NxsFormFieldComponent } from '@shared/forms/nxs-form-field/nxs-form-field.component';
import { PasswordToggleComponent } from '@shared/components/password-toggle/password-toggle.component';
import { parseHttpErrorMessage } from '@shared/utils/http-error.utils';
import { AuthService } from '../../services/auth.service';
import { countryOptions } from '../../utils/residence-country';
import {
  createStepUpFactorForm,
  stepUpFactorOf
} from '../../utils/step-up-factor-form';
import type { StepUpFactorsRequest } from '../../models/auth.types';
import { ResidenceCountryFieldComponent } from '../residence-country-field/residence-country-field.component';

/**
 * Which factor confirms a change for this account. `provider` has no field:
 * the page sends the user to the provider and the card resumes on return.
 */
type StepUpFactor = 'password' | 'code' | 'provider';

/**
 * The declared country of residence on the profile page. A change replaces a
 * legal record, so it needs the step-up of the account, as the server does.
 */
@Component({
  selector: 'nxs-residence-card',
  imports: [
    MatButton,
    MatCard,
    MatCardContent,
    MatCardHeader,
    MatCardTitle,
    MatProgressSpinner,
    NxsFormFieldComponent,
    PasswordToggleComponent,
    ResidenceCountryFieldComponent,
    TranslocoDirective
  ],
  templateUrl: './residence-card.component.html',
  styleUrl: './residence-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResidenceCardComponent {
  readonly #authService = inject(AuthService);
  readonly #regionConfig = inject(RegionConfigService);
  readonly #notify = inject(NotifyService);
  readonly #transloco = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);

  readonly user = input<UserResponse | null>(null);

  /** False for a role that may not edit its profile, as the server checks. */
  readonly canChange = input(false);

  /** Label of the provider a step-up round trip can run against. */
  readonly reauthProviderLabel = input('');

  /** The country a provider round trip was taken for, on the load after it. */
  readonly resumeChange = input<CountryCode | null>(null);

  /** Asks the page to take an account with no password through its provider. */
  readonly reauthRequested = output<CountryCode>();

  readonly userUpdated = output<UserResponse>();

  readonly #lang = toSignal(this.#transloco.langChanges$, {
    initialValue: this.#transloco.getActiveLang()
  });

  protected readonly countryName = computed(() => {
    const code = this.user()?.residenceCountry;

    if (!code) return null;

    return (
      countryOptions(this.#lang()).find((option) => option.code === code)
        ?.name ?? code
    );
  });

  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly peerUrl = signal<string | null>(null);

  readonly countryModel = signal<{ residenceCountry: CountryCode | '' }>({
    residenceCountry: ''
  });

  readonly countryForm = form(this.countryModel, (path) => {
    required(path.residenceCountry, {
      message: 'auth.register.residenceCountryRequired'
    });
  });

  readonly #stepUpFactor = computed(() => stepUpFactorOf(this.user()));

  protected readonly factor = computed<StepUpFactor>(() => {
    const factor = this.#stepUpFactor();

    return factor === 'none' ? 'provider' : factor;
  });

  /** An account with no password and no linked provider cannot prove itself. */
  protected readonly cannotStepUp = computed(
    () => this.factor() === 'provider' && !this.reauthProviderLabel()
  );

  readonly #stepUp = createStepUpFactorForm(this.#stepUpFactor, {
    passwordRequired: 'auth.residenceCard.passwordRequired',
    codeRequired: 'auth.residenceCard.codeRequired'
  });

  readonly passwordModel = this.#stepUp.passwordModel;
  readonly passwordForm = this.#stepUp.passwordForm;
  readonly codeModel = this.#stepUp.codeModel;
  readonly codeForm = this.#stepUp.codeForm;

  protected readonly saveBlocked = computed(
    () =>
      this.busy() ||
      this.countryForm().invalid() ||
      (this.factor() !== 'provider' && this.#stepUp.invalid())
  );

  /** A resumed round trip sends one request, however often the input emits. */
  #resumed = false;

  constructor() {
    effect(() => {
      const country = this.resumeChange();

      if (!country || this.#resumed) return;

      this.#resumed = true;
      this.#change(country, {});
    });
  }

  startChange(): void {
    this.#stepUp.reset();
    this.error.set(null);
    this.peerUrl.set(null);
    this.countryModel.set({
      residenceCountry: this.user()?.residenceCountry ?? ''
    });
    this.editing.set(true);
  }

  cancel(): void {
    this.#stepUp.reset();
    this.error.set(null);
    this.peerUrl.set(null);
    this.editing.set(false);
  }

  save(): void {
    const { residenceCountry } = this.countryModel();

    if (this.saveBlocked() || !residenceCountry) return;

    if (this.factor() === 'provider') {
      this.reauthRequested.emit(residenceCountry);

      return;
    }

    this.#change(residenceCountry, this.#stepUp.request());
  }

  #change(country: CountryCode, factors: StepUpFactorsRequest): void {
    this.busy.set(true);
    this.error.set(null);
    this.peerUrl.set(null);

    this.#authService
      .changeResidence(country, factors)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (user) => {
          this.busy.set(false);
          this.cancel();
          this.userUpdated.emit(user);
          this.#notify.success('auth.residenceCard.successChanged');
        },
        error: (err: HttpErrorResponse) => {
          const errorKey = err.error?.errorKey as string | undefined;

          this.busy.set(false);
          this.editing.set(true);
          this.#regionConfig
            .peerUrl(country, errorKey)
            .pipe(takeUntilDestroyed(this.#destroyRef))
            .subscribe((url) => this.peerUrl.set(url));
          this.error.set(
            parseHttpErrorMessage(
              err,
              this.#transloco,
              'auth.residenceCard.errorChangeFailed'
            )
          );
        }
      });
  }
}
