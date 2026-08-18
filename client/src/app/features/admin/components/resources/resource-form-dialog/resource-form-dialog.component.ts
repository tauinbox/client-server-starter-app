import type { OnDestroy, OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { form, maxLength, required } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { HttpErrorResponse } from '@angular/common/http';
import { parseHttpErrorMessage } from '@shared/utils/http-error.utils';
import type {
  ActionResponse,
  ResourceResponse
} from '@app/shared/types/rbac.types';
import type { UpdateResource } from '../../../services/rbac-admin.service';
import { RbacAdminService } from '../../../services/rbac-admin.service';
import { ResourcesStore } from '../../../store/resources.store';
import { KeyboardShortcutsService } from '@core/services/keyboard-shortcuts.service';
import { NotifyService } from '@core/services/notify.service';
import { NxsFormFieldComponent } from '@shared/forms/nxs-form-field/nxs-form-field.component';

export type ResourceFormDialogData = {
  resource: ResourceResponse;
};

type ResourceFormData = {
  displayName: string;
  description: string;
};

@Component({
  selector: 'nxs-resource-form-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatProgressSpinner,
    MatSlideToggleModule,
    MatCheckboxModule,
    MatDividerModule,
    MatIconModule,
    MatTooltipModule,
    TranslocoDirective,
    NxsFormFieldComponent
  ],
  templateUrl: './resource-form-dialog.component.html',
  styleUrl: './resource-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResourceFormDialogComponent implements OnInit, OnDestroy {
  readonly #dialogRef = inject(MatDialogRef<ResourceFormDialogComponent>);
  readonly #resourcesStore = inject(ResourcesStore);
  readonly #notify = inject(NotifyService);
  readonly #translocoService = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #shortcuts = inject(KeyboardShortcutsService);
  readonly #rbacService = inject(RbacAdminService);
  protected readonly data = inject<ResourceFormDialogData>(MAT_DIALOG_DATA);

  #cleanupSave: (() => void) | null = null;

  readonly resourceModel = signal<ResourceFormData>({
    displayName: this.data.resource.displayName,
    description: this.data.resource.description ?? ''
  });

  readonly resourceForm = form(this.resourceModel, (path) => {
    required(path.displayName);
    maxLength(path.displayName, 100);
  });

  protected readonly isCustomMode = signal(
    this.data.resource.allowedActionNames !== null
  );
  protected readonly selectedActionNames = signal<Set<string>>(
    new Set(this.data.resource.allowedActionNames ?? [])
  );
  protected readonly isLoading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  /**
   * The whole action catalog, never a page of it: the default-action seed below
   * would silently drop every action outside the page it did not see.
   */
  protected readonly actions = signal<ActionResponse[]>([]);
  protected readonly actionsLoaded = signal(false);
  protected readonly actionsFailed = signal(false);

  ngOnInit(): void {
    this.#cleanupSave = this.#shortcuts.registerSave(
      'shortcuts.labelSave',
      'shortcuts.groupForms',
      () => this.submit()
    );

    this.#rbacService
      .getActions()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (actions) => {
          this.actions.set(actions);
          this.actionsLoaded.set(true);
        },
        error: () => {
          this.actionsFailed.set(true);
        }
      });
  }

  ngOnDestroy(): void {
    this.#cleanupSave?.();
  }

  get isDirty(): boolean {
    const current = this.resourceModel();
    const resource = this.data.resource;
    if (
      current.displayName !== resource.displayName ||
      current.description !== (resource.description ?? '')
    ) {
      return true;
    }

    const original = resource.allowedActionNames;
    const isCustom = this.isCustomMode();

    if (original === null) return isCustom;
    if (!isCustom) return true;

    const selected = this.selectedActionNames();
    if (original.length !== selected.size) return true;
    return original.some((name) => !selected.has(name));
  }

  toggleCustomMode(enabled: boolean): void {
    if (enabled && !this.actionsLoaded()) return;
    this.isCustomMode.set(enabled);
    if (enabled && this.data.resource.allowedActionNames === null) {
      this.selectedActionNames.set(
        new Set(
          this.actions()
            .filter((a) => a.isDefault)
            .map((a) => a.name)
        )
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
    if (this.resourceForm().invalid() || !this.isDirty || this.isLoading())
      return;

    const { displayName, description } = this.resourceModel();
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
          this.#notify.success('admin.resources.successUpdated');
          this.#dialogRef.close(true);
        },
        error: (err: HttpErrorResponse) => {
          this.isLoading.set(false);
          this.errorMessage.set(
            parseHttpErrorMessage(
              err,
              this.#translocoService,
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
