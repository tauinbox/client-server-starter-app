import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import type { FormControl, FormGroup } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import {
  MatError,
  MatFormField,
  MatHint,
  MatLabel
} from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import type { ActionResponse } from '@app/shared/types/rbac.types';

export type ActionFormDialogData = {
  action?: ActionResponse;
};

export type ActionFormDialogResult = {
  name: string;
  displayName: string;
  description: string;
};

type ActionFormType = {
  name: FormControl<string>;
  displayName: FormControl<string>;
  description: FormControl<string>;
};

const ACTION_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

@Component({
  selector: 'app-action-form-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormField,
    MatLabel,
    MatError,
    MatHint,
    MatInput
  ],
  templateUrl: './action-form-dialog.component.html',
  styleUrl: './action-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActionFormDialogComponent {
  readonly #fb = inject(FormBuilder);
  readonly #dialogRef = inject(MatDialogRef<ActionFormDialogComponent>);
  protected readonly data = inject<ActionFormDialogData>(MAT_DIALOG_DATA);

  protected readonly isEdit = !!this.data.action;

  protected readonly form: FormGroup<ActionFormType> =
    this.#fb.group<ActionFormType>({
      name: this.#fb.control(this.data.action?.name ?? '', {
        validators: [
          Validators.required,
          Validators.maxLength(50),
          Validators.pattern(ACTION_NAME_PATTERN)
        ],
        nonNullable: true
      }),
      displayName: this.#fb.control(this.data.action?.displayName ?? '', {
        validators: [Validators.required, Validators.maxLength(100)],
        nonNullable: true
      }),
      description: this.#fb.control(this.data.action?.description ?? '', {
        validators: [Validators.maxLength(500)],
        nonNullable: true
      })
    });

  constructor() {
    if (this.isEdit) {
      this.form.get('name')?.disable();
    }
  }

  submit(): void {
    if (this.form.invalid) return;

    const { name, displayName, description } = this.form.getRawValue();
    const result: ActionFormDialogResult = {
      name: name.trim(),
      displayName: displayName.trim(),
      description: description.trim()
    };
    this.#dialogRef.close(result);
  }

  cancel(): void {
    this.#dialogRef.close();
  }
}
