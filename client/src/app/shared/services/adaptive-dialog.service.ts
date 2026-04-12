import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import type { Observable } from 'rxjs';
import { LayoutService } from '@core/services/layout.service';
import type { ConfirmDialogData } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { ConfirmBottomSheetComponent } from '@shared/components/confirm-dialog/confirm-bottom-sheet.component';
import { DialogSize, dialogSizeConfig } from '@shared/utils/dialog.utils';

/**
 * Opens confirm dialogs adaptively: as a bottom sheet on handset
 * viewports and as a standard dialog on larger screens.
 *
 * Form and wide dialogs are unaffected — use `MatDialog` directly
 * with `dialogSizeConfig()` for those.
 */
@Injectable({ providedIn: 'root' })
export class AdaptiveDialogService {
  readonly #dialog = inject(MatDialog);
  readonly #bottomSheet = inject(MatBottomSheet);
  readonly #layout = inject(LayoutService);

  /**
   * Opens a confirm dialog or bottom sheet depending on viewport.
   *
   * @returns Observable that emits `true` when confirmed, `false`
   *          or `undefined` when cancelled / dismissed.
   */
  openConfirm(data: ConfirmDialogData): Observable<boolean | undefined> {
    if (this.#layout.isHandset()) {
      return this.#bottomSheet
        .open<
          ConfirmBottomSheetComponent,
          ConfirmDialogData,
          boolean
        >(ConfirmBottomSheetComponent, { data })
        .afterDismissed();
    }

    return this.#dialog
      .open<
        ConfirmDialogComponent,
        ConfirmDialogData,
        boolean
      >(ConfirmDialogComponent, { ...dialogSizeConfig(DialogSize.Confirm), data })
      .afterClosed();
  }
}
