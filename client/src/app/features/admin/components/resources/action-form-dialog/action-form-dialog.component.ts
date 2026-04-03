import type { OnDestroy, OnInit } from '@angular/core';
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
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { ActionResponse } from '@app/shared/types/rbac.types';
import type {
  CreateAction,
  UpdateAction
} from '../../../services/rbac-admin.service';
import { ResourcesStore } from '../../../store/resources.store';
import { KeyboardShortcutsService } from '@core/services/keyboard-shortcuts.service';

export type ActionFormDialogData = {
  action?: ActionResponse;
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
    MatInput,
    MatProgressSpinner,
    TranslocoDirective
  ],
  templateUrl: './action-form-dialog.component.html',
  styleUrl: './action-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActionFormDialogComponent implements OnInit, OnDestroy {
  readonly #fb = inject(FormBuilder);
  readonly #dialogRef = inject(MatDialogRef<ActionFormDialogComponent>);
  readonly #resourcesStore = inject(ResourcesStore);
  readonly #snackBar = inject(MatSnackBar);
  readonly #translocoService = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #shortcuts = inject(KeyboardShortcutsService);
  protected readonly data = inject<ActionFormDialogData>(MAT_DIALOG_DATA);

  #cleanupCtrlS: (() => void) | null = null;
  #cleanupMetaS: (() => void) | null = null;

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

  protected readonly isLoading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  constructor() {
    if (this.isEdit) {
      this.form.get('name')?.disable();
    }
  }

  ngOnInit(): void {
    const save = () => this.submit();
    this.#cleanupCtrlS = this.#shortcuts.register(
      'ctrl+s',
      'shortcuts.labelSave',
      'shortcuts.groupForms',
      save
    );
    this.#cleanupMetaS = this.#shortcuts.register(
      'meta+s',
      'shortcuts.labelSave',
      'shortcuts.groupForms',
      save
    );
  }

  ngOnDestroy(): void {
    this.#cleanupCtrlS?.();
    this.#cleanupMetaS?.();
  }

  submit(): void {
    if (this.form.invalid || this.isLoading()) return;
    if (this.isEdit && !this.form.dirty) return;

    const { name, displayName, description } = this.form.getRawValue();

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
            this.#snackBar.open(
              this.#translocoService.translate('admin.actions.successUpdated'),
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
            this.#snackBar.open(
              this.#translocoService.translate('admin.actions.successCreated'),
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
