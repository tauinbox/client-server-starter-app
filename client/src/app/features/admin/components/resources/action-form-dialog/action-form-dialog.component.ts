import type { OnDestroy, OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  form,
  maxLength,
  pattern,
  readonly as readonlyField,
  required
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { ActionResponse } from '@app/shared/types/rbac.types';
import type {
  CreateAction,
  UpdateAction
} from '../../../services/rbac-admin.service';
import { ResourcesStore } from '../../../store/resources.store';
import { KeyboardShortcutsService } from '@core/services/keyboard-shortcuts.service';
import { NotifyService } from '@core/services/notify.service';
import { AppFormFieldComponent } from '@shared/forms/app-form-field/app-form-field.component';

export type ActionFormDialogData = {
  action?: ActionResponse;
};

type ActionFormData = {
  name: string;
  displayName: string;
  description: string;
};

const ACTION_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

@Component({
  selector: 'app-action-form-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinner,
    MatTooltipModule,
    TranslocoDirective,
    AppFormFieldComponent
  ],
  templateUrl: './action-form-dialog.component.html',
  styleUrl: './action-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActionFormDialogComponent implements OnInit, OnDestroy {
  readonly #dialogRef = inject(MatDialogRef<ActionFormDialogComponent>);
  readonly #resourcesStore = inject(ResourcesStore);
  readonly #notify = inject(NotifyService);
  readonly #translocoService = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #shortcuts = inject(KeyboardShortcutsService);
  protected readonly data = inject<ActionFormDialogData>(MAT_DIALOG_DATA);

  #cleanupSave: (() => void) | null = null;

  protected readonly isEdit = !!this.data.action;

  readonly actionModel = signal<ActionFormData>({
    name: this.data.action?.name ?? '',
    displayName: this.data.action?.displayName ?? '',
    description: this.data.action?.description ?? ''
  });

  readonly actionForm = form(this.actionModel, (path) => {
    required(path.name);
    maxLength(path.name, 50);
    pattern(path.name, ACTION_NAME_PATTERN);
    required(path.displayName);
    maxLength(path.displayName, 100);
    maxLength(path.description, 500);
    if (this.isEdit) {
      readonlyField(path.name);
    }
  });

  protected readonly isLoading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

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

  protected get formChanged(): boolean {
    const current = this.actionModel();
    const action = this.data.action;
    if (!action) return true;
    return (
      current.displayName !== action.displayName ||
      current.description !== (action.description ?? '')
    );
  }

  submit(): void {
    if (this.actionForm().invalid() || this.isLoading()) return;
    if (this.isEdit && !this.formChanged) return;

    const { name, displayName, description } = this.actionModel();

    this.isLoading.set(true);
    this.errorMessage.set(null);

    if (this.isEdit && this.data.action) {
      const dto: UpdateAction = {
        displayName: displayName.trim(),
        description: description.trim()
      };
      this.#resourcesStore
        .updateAction(this.data.action.id, dto)
        .pipe(takeUntilDestroyed(this.#destroyRef))
        .subscribe({
          next: () => {
            this.#notify.success('admin.actions.successUpdated');
            this.#dialogRef.close(true);
          },
          error: (err: { error?: { message?: string } }) => {
            this.isLoading.set(false);
            this.errorMessage.set(
              err.error?.message ??
                this.#translocoService.translate(
                  'admin.actions.errorUpdateFailed'
                )
            );
          }
        });
    } else {
      const dto: CreateAction = {
        name: name.trim(),
        displayName: displayName.trim(),
        description: description.trim() || undefined
      };
      this.#resourcesStore
        .createAction(dto)
        .pipe(takeUntilDestroyed(this.#destroyRef))
        .subscribe({
          next: () => {
            this.#notify.success('admin.actions.successCreated');
            this.#dialogRef.close(true);
          },
          error: (err: { error?: { message?: string } }) => {
            this.isLoading.set(false);
            this.errorMessage.set(
              err.error?.message ??
                this.#translocoService.translate(
                  'admin.actions.errorCreateFailed'
                )
            );
          }
        });
    }
  }

  cancel(): void {
    this.#dialogRef.close();
  }
}
