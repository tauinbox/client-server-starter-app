import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal
} from '@angular/core';
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
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import type {
  ActionResponse,
  ResourceResponse
} from '@app/shared/types/rbac.types';

export type ResourceFormDialogData = {
  resource: ResourceResponse;
  actions: ActionResponse[];
};

export type ResourceFormDialogResult = {
  displayName: string;
  description: string | null;
  allowedActionNames: string[] | null;
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
    MatInput,
    MatSlideToggleModule,
    MatCheckboxModule,
    MatDividerModule
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

  /** Whether the user has switched to custom actions mode (not auto/null) */
  protected readonly isCustomMode = signal(
    this.data.resource.allowedActionNames !== null
  );

  /** Selected action names in custom mode */
  protected readonly selectedActionNames = signal<Set<string>>(
    new Set(
      this.data.resource.allowedActionNames ??
        this.data.actions.filter((a) => a.isDefault).map((a) => a.name)
    )
  );

  get isDirty(): boolean {
    if (this.form.dirty) return true;

    const original = this.data.resource.allowedActionNames;
    const isCustom = this.isCustomMode();

    // null means auto-mode; non-null means custom list
    if (original === null) return isCustom;
    if (!isCustom) return true;

    const selected = this.selectedActionNames();
    if (original.length !== selected.size) return true;
    return original.some((name) => !selected.has(name));
  }

  toggleCustomMode(enabled: boolean): void {
    this.isCustomMode.set(enabled);
    if (enabled && this.data.resource.allowedActionNames === null) {
      // Switching to custom: pre-select all default actions
      this.selectedActionNames.set(
        new Set(this.data.actions.filter((a) => a.isDefault).map((a) => a.name))
      );
    }
  }

  toggleAction(actionName: string): void {
    const next = new Set(this.selectedActionNames());
    if (next.has(actionName)) {
      next.delete(actionName);
    } else {
      next.add(actionName);
    }
    this.selectedActionNames.set(next);
  }

  isActionSelected(actionName: string): boolean {
    return this.selectedActionNames().has(actionName);
  }

  submit(): void {
    if (this.form.invalid || !this.isDirty) return;

    const { displayName, description } = this.form.getRawValue();
    const result: ResourceFormDialogResult = {
      displayName: displayName.trim(),
      description: description.trim() || null,
      allowedActionNames: this.isCustomMode()
        ? Array.from(this.selectedActionNames())
        : null
    };
    this.#dialogRef.close(result);
  }

  cancel(): void {
    this.#dialogRef.close();
  }
}
