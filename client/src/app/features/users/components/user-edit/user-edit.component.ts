import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { MatButton, MatIconButton } from '@angular/material/button';
import { PasswordToggleComponent } from '@shared/components/password-toggle/password-toggle.component';
import { Router, RouterLink } from '@angular/router';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import type { FormControl, FormGroup } from '@angular/forms';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  MatError,
  MatFormField,
  MatLabel,
  MatSuffix
} from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatCheckbox } from '@angular/material/checkbox';
import { UserService } from '../../services/user.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { AuthStore } from '../../../auth/store/auth.store';
import type { UpdateUser, User } from '../../models/user.types';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import type { HttpErrorResponse } from '@angular/common/http';
import { rem } from '@shared/utils/css.utils';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { UsersStore } from '../../store/users.store';

type UserFormType = {
  email: FormControl<string>;
  firstName: FormControl<string>;
  lastName: FormControl<string>;
  password: FormControl<string>;
  isActive: FormControl<boolean>;
};

@Component({
  selector: 'app-user-edit',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatLabel,
    MatError,
    MatIconButton,
    RouterLink,
    MatIcon,
    MatCardContent,
    MatProgressSpinner,
    ReactiveFormsModule,
    MatFormField,
    MatInput,
    MatCheckbox,
    MatButton,
    PasswordToggleComponent,
    MatSuffix
  ],
  templateUrl: './user-edit.component.html',
  styleUrl: './user-edit.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserEditComponent implements OnInit {
  readonly #fb = inject(FormBuilder);
  readonly #userService = inject(UserService);
  readonly #usersStore = inject(UsersStore);
  readonly #router = inject(Router);
  readonly #snackBar = inject(MatSnackBar);
  readonly #dialog = inject(MatDialog);
  protected readonly authStore = inject(AuthStore);
  readonly #destroyRef = inject(DestroyRef);

  readonly id = input.required<string>();
  readonly user = signal<User | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  protected readonly userForm: FormGroup<UserFormType> =
    this.#fb.group<UserFormType>({
      email: this.#fb.control('', {
        validators: [Validators.required, Validators.email],
        nonNullable: true
      }),
      firstName: this.#fb.control('', {
        validators: [Validators.required],
        nonNullable: true
      }),
      lastName: this.#fb.control('', {
        validators: [Validators.required],
        nonNullable: true
      }),
      password: this.#fb.control('', {
        validators: [Validators.minLength(8)],
        nonNullable: true
      }),
      isActive: this.#fb.control(true, { nonNullable: true })
    });

  protected readonly canSubmit = computed(
    () => this.userForm.valid && !this.saving() && this.userForm.dirty
  );

  protected readonly canManageUser = computed(() =>
    this.authStore.hasPermission('update', 'User')
  );

  protected readonly canDelete = computed(
    () =>
      this.authStore.hasPermission('delete', 'User') &&
      this.id() !== this.authStore.user()?.id
  );

  ngOnInit() {
    this.loadUser();
  }

  loadUser(): void {
    this.loading.set(true);
    this.error.set(null);

    this.#userService
      .getById(this.id())
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (user) => {
          this.user.set(user);

          this.userForm.patchValue({
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            isActive: user.isActive,
            password: ''
          });

          this.userForm.markAsPristine();
          this.loading.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          const errorMessage =
            err.error?.message ||
            'Failed to load user details. Please try again.';
          this.error.set(errorMessage);
          this.#snackBar.open(errorMessage, 'Close', { duration: 5000 });
        }
      });
  }

  onSubmit(): void {
    if (!this.canSubmit()) return;

    const formValues = this.userForm.getRawValue();
    const updateData = this.#prepareUpdateData(formValues);

    this.saving.set(true);
    this.error.set(null);

    this.#usersStore
      .updateUser(this.id(), updateData)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (user) => this.#handleUpdateSuccess(user),
        error: (err) => this.#handleUpdateError(err)
      });
  }

  #prepareUpdateData(formValues: FormGroup<UserFormType>['value']): UpdateUser {
    const updateData: UpdateUser = {
      email: formValues.email,
      firstName: formValues.firstName,
      lastName: formValues.lastName
    };

    if (formValues.password?.trim()) {
      updateData.password = formValues.password;
    }

    if (this.authStore.hasPermission('update', 'User')) {
      updateData.isActive = formValues.isActive;
    }

    return updateData;
  }

  #handleUpdateSuccess(updatedUser: User): void {
    this.saving.set(false);
    this.user.set(updatedUser);

    if (this.id() === this.authStore.user()?.id) {
      this.authStore.updateCurrentUser(updatedUser);
    }

    this.userForm.patchValue({ password: '' });
    this.userForm.markAsPristine();

    this.#snackBar.open('User updated successfully', 'Close', {
      duration: 5000
    });
    void this.#router.navigate([`/${AppRouteSegmentEnum.Users}`, this.id()]);
  }

  #handleUpdateError(err: HttpErrorResponse): void {
    this.saving.set(false);
    this.error.set(
      err.error?.message || 'Failed to update user. Please try again.'
    );
  }

  unlockAccount(): void {
    this.saving.set(true);
    this.#usersStore
      .updateUser(this.id(), { unlockAccount: true })
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (user) => {
          this.saving.set(false);
          this.user.set(user);
          this.#snackBar.open('Account unlocked successfully', 'Close', {
            duration: 5000
          });
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.#snackBar.open(
            err.error?.message || 'Failed to unlock account',
            'Close',
            { duration: 5000 }
          );
        }
      });
  }

  confirmDelete(): void {
    if (!this.user()) return;

    this.#dialog
      .open(ConfirmDialogComponent, {
        width: rem(350),
        data: {
          title: 'Confirm Delete',
          message: `Are you sure you want to delete user ${this.user()!.firstName} ${this.user()!.lastName}?`,
          confirmButton: 'Delete',
          cancelButton: 'Cancel',
          icon: 'warning'
        }
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((result) => {
        if (result) {
          this.#deleteUser();
        }
      });
  }

  #deleteUser(): void {
    this.#usersStore
      .deleteUser(this.id())
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.#snackBar.open('User deleted successfully', 'Close', {
            duration: 5000
          });
          void this.#router.navigate([`/${AppRouteSegmentEnum.Users}`]);
        },
        error: (err: HttpErrorResponse) => {
          this.#snackBar.open(
            err.error?.message || 'Failed to delete user. Please try again.',
            'Close',
            { duration: 5000 }
          );
        }
      });
  }
}
