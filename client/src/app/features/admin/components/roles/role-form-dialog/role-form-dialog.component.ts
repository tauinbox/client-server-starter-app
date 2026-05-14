import type { OnDestroy, OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal
} from '@angular/core';
import {
  form,
  maxLength,
  readonly as readonlyField,
  required
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import {
  MatDialogModule,
  MatDialogRef,
  MAT_DIALOG_DATA
} from '@angular/material/dialog';
import { TranslocoDirective } from '@jsverse/transloco';
import type { RoleAdminResponse } from '@app/shared/types/role.types';
import { KeyboardShortcutsService } from '@core/services/keyboard-shortcuts.service';
import { AppFormFieldComponent } from '@shared/forms/nxs-form-field/nxs-form-field.component';

export type RoleFormDialogData = {
  role?: RoleAdminResponse;
};

export type RoleFormDialogResult = {
  name: string;
  description: string | null;
};

type RoleFormData = {
  name: string;
  description: string;
};

@Component({
  selector: 'nxs-role-form-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    TranslocoDirective,
    AppFormFieldComponent
  ],
  templateUrl: './role-form-dialog.component.html',
  styleUrl: './role-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RoleFormDialogComponent implements OnInit, OnDestroy {
  readonly #dialogRef = inject(MatDialogRef<RoleFormDialogComponent>);
  readonly #shortcuts = inject(KeyboardShortcutsService);
  protected readonly data = inject<RoleFormDialogData>(MAT_DIALOG_DATA);

  #cleanupSave: (() => void) | null = null;

  protected readonly isEdit = !!this.data.role;

  readonly roleModel = signal<RoleFormData>({
    name: this.data.role?.name ?? '',
    description: this.data.role?.description ?? ''
  });

  readonly roleForm = form(this.roleModel, (path) => {
    required(path.name);
    maxLength(path.name, 50);
    maxLength(path.description, 255);
    if (this.isSystemRole) {
      readonlyField(path.name);
      readonlyField(path.description);
    }
  });

  protected readonly isSystemRole = this.data.role?.isSystem ?? false;

  protected get formChanged(): boolean {
    const current = this.roleModel();
    const role = this.data.role;
    if (!role) return true;
    return (
      current.name !== role.name ||
      current.description !== (role.description ?? '')
    );
  }

  ngOnInit(): void {
    this.#cleanupSave = this.#shortcuts.registerSave(
      'shortcuts.labelSave',
      'shortcuts.groupForms',
      () => this.submit()
    );
  }

  ngOnDestroy(): void {
    this.#cleanupSave?.();
  }

  submit(): void {
    if (this.roleForm().invalid()) return;

    const { name, description } = this.roleModel();
    const result: RoleFormDialogResult = {
      name: name.trim(),
      description: description.trim() || null
    };
    this.#dialogRef.close(result);
  }

  cancel(): void {
    this.#dialogRef.close();
  }
}
