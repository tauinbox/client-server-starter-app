import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal
} from '@angular/core';
import {
  MatCard,
  MatCardActions,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import {
  email as emailValidator,
  form,
  minLength,
  required
} from '@angular/forms/signals';
import { AppFormFieldComponent } from '@shared/forms/app-form-field/app-form-field.component';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import type { HttpErrorResponse } from '@angular/common/http';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PasswordToggleComponent } from '@shared/components/password-toggle/password-toggle.component';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

type RegisterData = {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
};

@Component({
  selector: 'app-register',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    MatButton,
    MatProgressSpinner,
    MatCardActions,
    RouterLink,
    AppFormFieldComponent,
    PasswordToggleComponent,
    TranslocoDirective
  ],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RegisterComponent {
  readonly #authService = inject(AuthService);
  readonly #router = inject(Router);
  readonly #destroyRef = inject(DestroyRef);
  readonly #translocoService = inject(TranslocoService);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly appRouteSegmentEnum = AppRouteSegmentEnum;

  readonly registerModel = signal<RegisterData>({
    email: '',
    firstName: '',
    lastName: '',
    password: ''
  });

  readonly registerForm = form(this.registerModel, (path) => {
    required(path.email, { message: 'auth.register.emailRequired' });
    emailValidator(path.email, { message: 'auth.register.emailInvalid' });
    required(path.firstName, { message: 'auth.register.firstNameRequired' });
    required(path.lastName, { message: 'auth.register.lastNameRequired' });
    required(path.password, { message: 'auth.register.passwordRequired' });
    minLength(path.password, 8, {
      message: 'auth.register.passwordMinLength'
    });
  });

  protected readonly passwordStrength = computed(() => {
    const pwd = this.registerModel().password;
    if (!pwd || pwd.length === 0) return 0;
    let score = 0;
    if (pwd.length >= 8) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[a-z]/.test(pwd)) score++;
    if (/[0-9!@#$%^&*]/.test(pwd)) score++;
    return Math.max(score, 1);
  });

  onSubmit(): void {
    if (this.registerForm().invalid()) return;

    this.loading.set(true);
    this.error.set(null);

    this.#authService
      .register(this.registerModel())
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          void this.#router.navigate([`/${AppRouteSegmentEnum.Login}`], {
            queryParams: { registered: 'pending-verification' }
          });
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          if (err.status === 409) {
            this.error.set(
              this.#translocoService.translate('auth.register.errorEmailExists')
            );
          } else {
            const errorKey = err.error?.errorKey as string | undefined;
            this.error.set(
              errorKey
                ? this.#translocoService.translate(errorKey)
                : this.#translocoService.translate('auth.register.errorFailed')
            );
          }
        }
      });
  }
}
