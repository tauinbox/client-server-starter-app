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
  MatPrefix,
  MatSuffix
} from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { UserService } from '../../services/user.service';
import { RoleService } from '../../../admin/services/role.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { AuthStore } from '../../../auth/store/auth.store';
import type { UpdateUser, User } from '../../models/user.types';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import type { HttpErrorResponse } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { catchError, forkJoin, of, tap } from 'rxjs';
import { rem } from '@shared/utils/css.utils';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { UsersStore } from '../../store/users.store';
import type { RoleResponse } from '@app/shared/types/role.types';

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
    MatSuffix,
    MatPrefix,
    MatSelect,
    MatOption
  ],
  templateUrl: './user-edit.component.html',
  styleUrl: './user-edit.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserEditComponent implements OnInit {
  readonly #fb = inject(FormBuilder);
  readonly #userService = inject(UserService);
  readonly #roleService = inject(RoleService);
  readonly #usersStore = inject(UsersStore);
  readonly #router = inject(Router);
  readonly #snackBar = inject(MatSnackBar);
  readonly #dialog = inject(MatDialog);
  readonly #destroyRef = inject(DestroyRef);
  protected readonly authStore = inject(AuthStore);

  readonly id = input.required<string>();
  readonly user = signal<User | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly availableRoles = signal<RoleResponse[]>([]);
  readonly selectedRoleIds = signal<string[]>([]);
  readonly #initialRoleIds = signal<string[]>([]);

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

  protected readonly rolesChanged = computed(() => {
    const initial = this.#initialRoleIds();
    const selected = this.selectedRoleIds();
    if (initial.length !== selected.length) return true;
    return selected.some((id) => !initial.includes(id));
  });

  protected readonly canSubmit = computed(
    () =>
      this.userForm.valid &&
      !this.saving() &&
      (this.userForm.dirty || this.rolesChanged())
  );

  protected readonly canManageUser = computed(() =>
    this.authStore.hasPermission('update', 'User')
  );

  protected readonly canAssignRoles = computed(() =>
    this.authStore.hasPermission('assign', 'Role')
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

    forkJoin({
      user: this.#userService.getById(this.id()),
      roles: this.#roleService.getAll().pipe(catchError(() => of([])))
    })
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: ({ user, roles }) => {
          this.availableRoles.set(roles);
          this.user.set(user);

          this.userForm.patchValue({
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            isActive: user.isActive,
            password: ''
          });
          this.userForm.markAsPristine();

          const roleNameToId = new Map(roles.map((r) => [r.name, r.id]));
          const roleIds = user.roles
            .map((name) => roleNameToId.get(name))
            .filter((id): id is string => id !== undefined);
          this.#initialRoleIds.set(roleIds);
          this.selectedRoleIds.set([...roleIds]);

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

  onRolesChange(roleIds: string[]): void {
    this.selectedRoleIds.set(roleIds);
  }

  onSubmit(): void {
    if (!this.canSubmit()) return;

    this.saving.set(true);
    this.error.set(null);

    const ops: Observable<unknown>[] = [];
    let updatedUser: User | null = null;

    if (this.userForm.dirty) {
      const updateData = this.#prepareUpdateData(this.userForm.getRawValue());
      ops.push(
        this.#usersStore.updateUser(this.id(), updateData).pipe(
          tap((user) => {
            updatedUser = user;
          })
        )
      );
    }

    if (this.rolesChanged()) {
      const initial = this.#initialRoleIds();
      const selected = this.selectedRoleIds();
      const toAdd = selected.filter((id) => !initial.includes(id));
      const toRemove = initial.filter((id) => !selected.includes(id));

      for (const roleId of toAdd) {
        ops.push(this.#roleService.assignRoleToUser(this.id(), roleId));
      }
      for (const roleId of toRemove) {
        ops.push(this.#roleService.removeRoleFromUser(this.id(), roleId));
      }
    }

    (ops.length ? forkJoin(ops) : of([null]))
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);

          if (updatedUser) {
            this.user.set(updatedUser);
            if (this.id() === this.authStore.user()?.id) {
              this.authStore.updateCurrentUser(updatedUser);
            }
          }

          this.#initialRoleIds.set([...this.selectedRoleIds()]);
          this.userForm.patchValue({ password: '' });
          this.userForm.markAsPristine();

          this.#snackBar.open('User updated successfully', 'Close', {
            duration: 5000
          });
          void this.#router.navigate([
            `/${AppRouteSegmentEnum.Admin}`,
            AppRouteSegmentEnum.Users,
            this.id()
          ]);
        },
        error: (err: HttpErrorResponse) => this.#handleUpdateError(err)
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
          void this.#router.navigate([
            `/${AppRouteSegmentEnum.Admin}`,
            AppRouteSegmentEnum.Users
          ]);
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
