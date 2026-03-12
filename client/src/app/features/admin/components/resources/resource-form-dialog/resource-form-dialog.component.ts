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
import type { ResourceResponse } from '@app/shared/types/rbac.types';

export type ResourceFormDialogData = {
  resource: ResourceResponse;
};

export type ResourceFormDialogResult = {
  displayName: string;
  description: string | null;
};

type ResourceFormType = {
  displayName: FormControl<string>;
  description: FormControl<string>;
};

@Component({
  selector: 'app-resource-form-dialog',
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
  templateUrl: './resource-form-dialog.component.html',
  styleUrl: './resource-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResourceFormDialogComponent {
  readonly #fb = inject(FormBuilder);
  readonly #dialogRef = inject(MatDialogRef<ResourceFormDialogComponent>);
  protected readonly data = inject<ResourceFormDialogData>(MAT_DIALOG_DATA);

  protected readonly form: FormGroup<ResourceFormType> =
    this.#fb.group<ResourceFormType>({
      displayName: this.#fb.control(this.data.resource.displayName, {
        validators: [Validators.required, Validators.maxLength(100)],
        nonNullable: true
      }),
      description: this.#fb.control(this.data.resource.description ?? '', {
        validators: [],
        nonNullable: true
      })
    });

  submit(): void {
    if (this.form.invalid) return;

    const { displayName, description } = this.form.getRawValue();
    const result: ResourceFormDialogResult = {
      displayName: displayName.trim(),
      description: description.trim() || null
    };
    this.#dialogRef.close(result);
  }

  cancel(): void {
    this.#dialogRef.close();
  }
}
