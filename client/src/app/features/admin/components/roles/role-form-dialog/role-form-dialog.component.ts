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
export class RoleFormDialogComponent {
  readonly #fb = inject(FormBuilder);
  readonly #dialogRef = inject(MatDialogRef<RoleFormDialogComponent>);
  protected readonly data = inject<RoleFormDialogData>(MAT_DIALOG_DATA);

  protected readonly isEdit = !!this.data.role;

  protected readonly form: FormGroup<RoleFormType> =
    this.#fb.group<RoleFormType>({
      name: this.#fb.control(this.data.role?.name ?? '', {
        validators: [Validators.required, Validators.maxLength(50)],
        nonNullable: true
      }),
      description: this.#fb.control(this.data.role?.description ?? '', {
        validators: [Validators.maxLength(255)],
        nonNullable: true
      })
    });

  protected readonly isSystemRole = this.data.role?.isSystem ?? false;

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
