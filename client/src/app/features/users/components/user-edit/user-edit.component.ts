import type { OnDestroy, OnInit } from '@angular/core';
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
import { email, form, minLength, required } from '@angular/forms/signals';
import {
  MatFormField,
  MatLabel,
  MatPrefix
} from '@angular/material/form-field';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatChipSet, MatChip, MatChipAvatar } from '@angular/material/chips';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { UserService } from '../../services/user.service';
import { RoleService } from '../../../admin/services/role.service';
import { NotifyService } from '@core/services/notify.service';
import { AuthStore } from '../../../auth/store/auth.store';
import type { UpdateUser, User } from '../../models/user.types';
import type { HttpErrorResponse } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { catchError, forkJoin, of, tap } from 'rxjs';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { UsersStore } from '../../store/users.store';
import type { RoleAdminResponse } from '@app/shared/types/role.types';
import { KeyboardShortcutsService } from '@core/services/keyboard-shortcuts.service';
import { AppFormFieldComponent } from '@shared/forms/app-form-field/app-form-field.component';

type UserFormData = {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
};

const INITIAL_USER_FORM: UserFormData = {
  email: '',
  firstName: '',
  lastName: '',
  password: ''
};

@Component({
  selector: 'app-user-edit',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatLabel,
    MatIconButton,
    RouterLink,
    MatIcon,
    MatCardContent,
    MatProgressSpinner,
    MatFormField,
    MatCheckbox,
    MatChipSet,
    MatChip,
    MatChipAvatar,
    MatButton,
    PasswordToggleComponent,
    MatPrefix,
    MatSelect,
    MatOption,
    TranslocoDirective,
    AppFormFieldComponent
  ],
  templateUrl: './user-edit.component.html',
  styleUrl: './user-edit.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserEditComponent implements OnInit, OnDestroy {
  readonly #userService = inject(UserService);
  readonly #roleService = inject(RoleService);
  readonly #usersStore = inject(UsersStore);
  readonly #authStore = inject(AuthStore);
  readonly #router = inject(Router);
  readonly #notify = inject(NotifyService);
  readonly #adaptiveDialog = inject(AdaptiveDialogService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #translocoService = inject(TranslocoService);
  readonly #shortcuts = inject(KeyboardShortcutsService);

  readonly id = input.required<string>();
  readonly user = signal<User | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly availableRoles = signal<RoleAdminResponse[]>([]);
  readonly selectedRoleIds = signal<string[]>([]);
  readonly #initialRoleIds = signal<string[]>([]);
  readonly isActive = signal(true);
  readonly #initialIsActive = signal(true);

  #cleanupSave: (() => void) | null = null;

  readonly userModel = signal<UserFormData>({ ...INITIAL_USER_FORM });
  readonly #initialFormData = signal<UserFormData>({ ...INITIAL_USER_FORM });

  readonly userForm = form(this.userModel, (path) => {
    required(path.email, { message: 'users.edit.emailRequired' });
    email(path.email, { message: 'users.edit.emailInvalid' });
    required(path.firstName, { message: 'users.edit.firstNameRequired' });
    required(path.lastName, { message: 'users.edit.lastNameRequired' });
    minLength(path.password, 8);
  });

  protected readonly formChanged = computed(() => {
    const current = this.userModel();
    const initial = this.#initialFormData();
    return (
      current.email !== initial.email ||
      current.firstName !== initial.firstName ||
      current.lastName !== initial.lastName ||
      current.password !== initial.password
    );
  });

  protected readonly rolesChanged = computed(() => {
    const initial = this.#initialRoleIds();
    const selected = this.selectedRoleIds();
    if (initial.length !== selected.length) return true;
    return selected.some((id) => !initial.includes(id));
  });

  protected readonly isActiveChanged = computed(
    () => this.isActive() !== this.#initialIsActive()
  );

  protected readonly canSubmit = computed(() => {
    const state = this.userForm();
    return (
      state.valid() &&
      !this.saving() &&
      (this.formChanged() || this.rolesChanged() || this.isActiveChanged())
    );
  });

  protected readonly canManageUser = computed(() => {
    const u = this.user();
    if (!u) return false;
    return this.#authStore.hasPermissions({
      action: 'update',
      subject: 'User',
      instance: { id: u.id }
    });
  });

  protected readonly canAssignRoles = computed(() =>
    this.#authStore.hasPermissions({ action: 'assign', subject: 'Role' })
  );

  protected readonly canDelete = computed(() => {
    const u = this.user();
    if (!u) return false;
    return (
      this.#authStore.hasPermissions({
        action: 'delete',
        subject: 'User',
        instance: { id: u.id }
      }) && this.id() !== this.#authStore.user()?.id
    );
  });

  ngOnInit(): void {
    this.loadUser();
    this.#cleanupSave = this.#shortcuts.registerSave(
      'shortcuts.labelSave',
      'shortcuts.groupForms',
      () => this.onSubmit()
    );
  }

  ngOnDestroy(): void {
    this.#cleanupSave?.();
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

          const formData: UserFormData = {
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            password: ''
          };
          this.userModel.set(formData);
          this.#initialFormData.set({ ...formData });
          this.isActive.set(user.isActive);
          this.#initialIsActive.set(user.isActive);
          this.userForm().reset();

          const roleIds = user.roles.map((role) => role.id);
          this.#initialRoleIds.set(roleIds);
          this.selectedRoleIds.set([...roleIds]);

          this.loading.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          this.error.set(
            err.error?.message ||
              this.#translocoService.translate('users.edit.errorLoadFailed')
          );
          this.#notify.error(err, 'users.edit.errorLoadFailed');
        }
      });
  }

  onRolesChange(roleIds: string[]): void {
    this.selectedRoleIds.set(roleIds);
  }

  onSubmit(): void {
    if (!this.canSubmit()) return;

    const newEmail = this.userModel().email;
    const emailChanged = newEmail !== this.#initialFormData().email;
    const u = this.user();

    if (!emailChanged || !u) {
      this.#performSave();
      return;
    }

    this.#adaptiveDialog
      .openConfirm({
        title: this.#translocoService.translate(
          'users.edit.confirmEmailChangeTitle'
        ),
        message: this.#translocoService.translate(
          'users.edit.confirmEmailChangeMessage',
          {
            firstName: u.firstName,
            lastName: u.lastName,
            newEmail
          }
        ),
        confirmButton: this.#translocoService.translate(
          'users.edit.confirmEmailChangeButton'
        ),
        cancelButton: this.#translocoService.translate('common.cancel'),
        icon: 'mark_email_unread'
      })
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) {
          this.#performSave();
        }
      });
  }

  #performSave(): void {
    this.saving.set(true);
    this.error.set(null);

    const ops: Observable<unknown>[] = [];
    let updatedUser: User | null = null;

    if (this.formChanged() || this.isActiveChanged()) {
      const updateData = this.#prepareUpdateData();
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
            if (this.id() === this.#authStore.user()?.id) {
              this.#authStore.updateCurrentUser(updatedUser);
            }
          }

          this.#initialRoleIds.set([...this.selectedRoleIds()]);
          this.#initialIsActive.set(this.isActive());
          this.userModel.update((m) => ({ ...m, password: '' }));
          this.#initialFormData.set({ ...this.userModel() });
          this.userForm().reset();

          this.#notify.success('users.edit.successUpdated');
          void this.#router.navigate([
            `/${AppRouteSegmentEnum.Admin}`,
            AppRouteSegmentEnum.Users,
            this.id()
          ]);
        },
        error: (err: HttpErrorResponse) => this.#handleUpdateError(err)
      });
  }

  #prepareUpdateData(): UpdateUser {
    const { email: emailVal, firstName, lastName, password } = this.userModel();
    const updateData: UpdateUser = {
      email: emailVal,
      firstName,
      lastName
    };

    if (password?.trim()) {
      updateData.password = password;
    }

    if (this.canManageUser()) {
      updateData.isActive = this.isActive();
    }

    return updateData;
  }

  #handleUpdateError(err: HttpErrorResponse): void {
    this.saving.set(false);
    this.error.set(
      err.error?.message ||
        this.#translocoService.translate('users.edit.errorUpdateFailed')
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
          this.#notify.success('users.edit.successUnlocked');
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.#notify.error(err, 'users.edit.errorUnlockFailed');
        }
      });
  }

  confirmDelete(): void {
    if (!this.user()) return;

    this.#adaptiveDialog
      .openConfirm({
        title: this.#translocoService.translate(
          'users.edit.confirmDeleteTitle'
        ),
        message: this.#translocoService.translate(
          'users.edit.confirmDeleteMessage',
          {
            firstName: this.user()!.firstName,
            lastName: this.user()!.lastName
          }
        ),
        confirmButton: this.#translocoService.translate('common.delete'),
        cancelButton: this.#translocoService.translate('common.cancel'),
        icon: 'warning'
      })
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
          this.#notify.success('users.edit.successDeleted');
          void this.#router.navigate([
            `/${AppRouteSegmentEnum.Admin}`,
            AppRouteSegmentEnum.Users
          ]);
        },
        error: (err: HttpErrorResponse) => {
          this.#notify.error(err, 'users.edit.errorDeleteFailed');
        }
      });
  }
}
