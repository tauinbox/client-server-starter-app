import type { OnDestroy, OnInit } from '@angular/core';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import type { FormControl, FormGroup } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MatDialogModule,
  MatDialogRef,
  MAT_DIALOG_DATA
} from '@angular/material/dialog';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { TranslocoDirective } from '@jsverse/transloco';
import type { RoleResponse } from '@app/shared/types/role.types';
import { KeyboardShortcutsService } from '@core/services/keyboard-shortcuts.service';

export type RoleFormDialogData = {
  role?: RoleResponse;
};

export type RoleFormDialogResult = {
  name: string;
  description: string | null;
};

type RoleFormType = {
  name: FormControl<string>;
  description: FormControl<string>;
};

@Component({
  selector: 'app-role-form-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormField,
    MatLabel,
    MatError,
    MatInput,
    TranslocoDirective
  ],
  templateUrl: './role-form-dialog.component.html',
  styleUrl: './role-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RoleFormDialogComponent implements OnInit, OnDestroy {
  readonly #fb = inject(FormBuilder);
  readonly #dialogRef = inject(MatDialogRef<RoleFormDialogComponent>);
  readonly #shortcuts = inject(KeyboardShortcutsService);
  protected readonly data = inject<RoleFormDialogData>(MAT_DIALOG_DATA);

  #cleanupSave: (() => void) | null = null;

  protected readonly isEdit = !!this.data.role;

  protected readonly form: FormGroup<RoleFormType> =
    this.#fb.group<RoleFormType>({
      name: this.#fb.control(this.data.role?.name ?? '', {
        validators: [Validators.required, Validators.maxLength(50)],
        nonNullable: true,
        updateOn: 'blur'
      }),
      description: this.#fb.control(this.data.role?.description ?? '', {
        validators: [Validators.maxLength(255)],
        nonNullable: true,
        updateOn: 'blur'
      })
    });

  protected readonly isSystemRole = this.data.role?.isSystem ?? false;

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
    if (this.form.invalid) return;

    const { name, description } = this.form.getRawValue();
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
