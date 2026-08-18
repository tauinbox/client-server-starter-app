import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  ViewContainerRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { MatChip } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  MatCell,
  MatCellDef,
  MatColumnDef,
  MatHeaderCell,
  MatHeaderCellDef,
  MatHeaderRow,
  MatHeaderRowDef,
  MatRow,
  MatRowDef,
  MatTable
} from '@angular/material/table';
import type { ActionResponse } from '@app/shared/types';
import { NotifyService } from '@core/services/notify.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { DialogSize, dialogSizeConfig } from '@shared/utils/dialog.utils';
import { ActionsStore } from '../../../store/actions.store';
import { InfiniteScrollDirective } from '@shared/directives/infinite-scroll.directive';
import type { ActionFormDialogData } from '../action-form-dialog/action-form-dialog.component';
import { ActionFormDialogComponent } from '../action-form-dialog/action-form-dialog.component';

@Component({
  selector: 'nxs-action-list',
  imports: [
    DatePipe,
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatButton,
    MatIconButton,
    MatIcon,
    MatProgressSpinner,
    InfiniteScrollDirective,
    MatTooltip,
    MatChip,
    MatTable,
    MatColumnDef,
    MatHeaderCell,
    MatCellDef,
    MatHeaderRow,
    MatRow,
    MatHeaderCellDef,
    MatHeaderRowDef,
    MatRowDef,
    MatCell,
    TranslocoDirective
  ],
  templateUrl: './action-list.component.html',
  styleUrl: './action-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActionListComponent implements OnInit {
  readonly #actionsStore = inject(ActionsStore);
  readonly #dialog = inject(MatDialog);
  readonly #adaptiveDialog = inject(AdaptiveDialogService);
  readonly #notify = inject(NotifyService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #translocoService = inject(TranslocoService);
  readonly #viewContainerRef = inject(ViewContainerRef);
  protected readonly authStore = inject(AuthStore);

  readonly loading = this.#actionsStore.loading;
  readonly actions = this.#actionsStore.actions;
  readonly hasMore = this.#actionsStore.hasMore;
  readonly isLoadingMore = this.#actionsStore.isLoadingMore;
  readonly busy = computed(
    () => this.#actionsStore.loading() || this.#actionsStore.isLoadingMore()
  );

  loadMore(): void {
    this.#actionsStore.loadMore();
  }

  readonly actionColumns = [
    'displayName',
    'name',
    'description',
    'default',
    'createdAt',
    'actions'
  ];

  readonly canUpdate = computed(() =>
    this.authStore.hasPermissions({ action: 'update', subject: 'Permission' })
  );
  readonly canCreate = computed(() =>
    this.authStore.hasPermissions({ action: 'create', subject: 'Permission' })
  );
  readonly canDelete = computed(() =>
    this.authStore.hasPermissions({ action: 'delete', subject: 'Permission' })
  );

  ngOnInit(): void {
    this.#actionsStore.load();
  }

  openAddAction(): void {
    const data: ActionFormDialogData = {};
    this.#dialog.open(ActionFormDialogComponent, {
      ...dialogSizeConfig(DialogSize.Form),
      viewContainerRef: this.#viewContainerRef,
      data
    });
  }

  openEditAction(action: ActionResponse): void {
    const data: ActionFormDialogData = { action };
    this.#dialog.open(ActionFormDialogComponent, {
      ...dialogSizeConfig(DialogSize.Form),
      viewContainerRef: this.#viewContainerRef,
      data
    });
  }

  confirmDeleteAction(action: ActionResponse): void {
    this.#adaptiveDialog
      .openConfirm({
        title: this.#translocoService.translate(
          'admin.actions.confirmDeleteTitle'
        ),
        message: this.#translocoService.translate(
          'admin.actions.confirmDeleteMessage',
          { name: action.displayName }
        ),
        confirmButton: this.#translocoService.translate('common.delete'),
        cancelButton: this.#translocoService.translate('common.cancel'),
        icon: 'warning'
      })
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((confirmed: boolean | undefined) => {
        if (confirmed) {
          this.#actionsStore
            .deleteAction(action.id)
            .pipe(takeUntilDestroyed(this.#destroyRef))
            .subscribe({
              next: () => {
                this.#notify.success('admin.actions.successDeleted');
              },
              error: (err) => {
                this.#notify.error(err, 'admin.actions.errorDeleteFailed');
              }
            });
        }
      });
  }
}
