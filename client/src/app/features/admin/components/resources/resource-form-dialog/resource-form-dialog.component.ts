import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type {
  ActionResponse,
  ResourceResponse
} from '@app/shared/types/rbac.types';
import type { UpdateResource } from '../../../services/rbac-admin.service';
import { ResourcesStore } from '../../../store/resources.store';

export type ResourceFormDialogData = {
  resource: ResourceResponse;
  actions: ActionResponse[];
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
    MatProgressSpinner,
    MatSlideToggleModule,
    MatCheckboxModule,
    MatDividerModule,
    TranslocoDirective
  ],
  templateUrl: './resource-form-dialog.component.html',
  styleUrl: './resource-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResourceFormDialogComponent {
  readonly #fb = inject(FormBuilder);
  readonly #dialogRef = inject(MatDialogRef<ResourceFormDialogComponent>);
  readonly #resourcesStore = inject(ResourcesStore);
  readonly #snackBar = inject(MatSnackBar);
  readonly #translocoService = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);
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

  protected readonly isCustomMode = signal(
    this.data.resource.allowedActionNames !== null
  );
  protected readonly selectedActionNames = signal<Set<string>>(
    new Set(
      this.data.resource.allowedActionNames ??
        this.data.actions.filter((a) => a.isDefault).map((a) => a.name)
    )
  );
  protected readonly isLoading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  get isDirty(): boolean {
    if (this.form.dirty) return true;

    const original = this.data.resource.allowedActionNames;
    const isCustom = this.isCustomMode();

    if (original === null) return isCustom;
    if (!isCustom) return true;

    const selected = this.selectedActionNames();
    if (original.length !== selected.size) return true;
    return original.some((name) => !selected.has(name));
  }

  toggleCustomMode(enabled: boolean): void {
    this.isCustomMode.set(enabled);
    if (enabled && this.data.resource.allowedActionNames === null) {
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
    if (this.form.invalid || !this.isDirty || this.isLoading()) return;

    const { displayName, description } = this.form.getRawValue();
    const dto: UpdateResource = {
      displayName: displayName.trim(),
      description: description.trim() || null,
      allowedActionNames: this.isCustomMode()
        ? Array.from(this.selectedActionNames())
        : null
    };

    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.#resourcesStore
      .updateResource(this.data.resource.id, dto)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.#snackBar.open(
            this.#translocoService.translate('admin.resources.successUpdated'),
            this.#translocoService.translate('common.close'),
            { duration: 5000 }
          );
          this.#dialogRef.close(true);
        },
        error: (err: { error?: { message?: string } }) => {
          this.isLoading.set(false);
          this.errorMessage.set(
            err.error?.message ??
              this.#translocoService.translate(
                'admin.resources.errorUpdateFailed'
              )
          );
        }
      });
  }

  cancel(): void {
    this.#dialogRef.close();
  }
}
