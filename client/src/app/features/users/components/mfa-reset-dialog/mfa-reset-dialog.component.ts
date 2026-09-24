import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { form, required } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle
} from '@angular/material/dialog';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { HttpErrorResponse } from '@angular/common/http';
import { parseHttpErrorMessage } from '@shared/utils/http-error.utils';
import { PasswordToggleComponent } from '@shared/components/password-toggle/password-toggle.component';
import { NxsFormFieldComponent } from '@shared/forms/nxs-form-field/nxs-form-field.component';
import { NotifyService } from '@core/services/notify.service';
import { UsersStore } from '../../store/users.store';
import type { MfaResetRequest } from '../../services/user.service';
import type { User } from '../../models/user.types';

/**
 * The factor the CALLER proves itself with. `none` is an account with neither
 * a password nor an authenticator, which the route refuses.
 */
export type MfaResetStepUpFactor = 'password' | 'code' | 'none';

export type MfaResetDialogData = {
  user: User;
  factor: MfaResetStepUpFactor;
};

@Component({
  selector: 'nxs-mfa-reset-dialog',
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatProgressSpinner,
    TranslocoDirective,
    PasswordToggleComponent,
    NxsFormFieldComponent
  ],
  templateUrl: './mfa-reset-dialog.component.html',
  styleUrl: './mfa-reset-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MfaResetDialogComponent {
  readonly #dialogRef =
    inject<MatDialogRef<MfaResetDialogComponent, User>>(MatDialogRef);
  readonly #usersStore = inject(UsersStore);
  readonly #notify = inject(NotifyService);
  readonly #translocoService = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);
  protected readonly data = inject<MfaResetDialogData>(MAT_DIALOG_DATA);

  readonly passwordModel = signal({ currentPassword: '' });
  readonly passwordForm = form(this.passwordModel, (path) => {
    required(path.currentPassword, {
      message: 'users.edit.currentPasswordRequired'
    });
  });

  readonly codeModel = signal({ code: '' });
  readonly codeForm = form(this.codeModel, (path) => {
    required(path.code, { message: 'users.edit.stepUpCodeRequired' });
  });

  protected readonly isLoading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly canSubmit = computed(() => {
    if (this.isLoading()) return false;
    switch (this.data.factor) {
      case 'password':
        return this.passwordForm().valid();
      case 'code':
        return this.codeForm().valid();
      default:
        return false;
    }
  });

  submit(): void {
    if (!this.canSubmit()) return;

    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.#usersStore
      .resetMfa(this.data.user.id, this.#request())
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (user) => {
          this.#notify.success('users.edit.successMfaReset');
          this.#dialogRef.close(user);
        },
        error: (err: HttpErrorResponse) => {
          this.isLoading.set(false);
          this.errorMessage.set(
            parseHttpErrorMessage(
              err,
              this.#translocoService,
              'users.edit.errorMfaResetFailed'
            )
          );
        }
      });
  }

  cancel(): void {
    this.#dialogRef.close();
  }

  #request(): MfaResetRequest {
    return this.data.factor === 'code'
      ? { code: this.codeModel().code.trim() }
      : { currentPassword: this.passwordModel().currentPassword };
  }
}
