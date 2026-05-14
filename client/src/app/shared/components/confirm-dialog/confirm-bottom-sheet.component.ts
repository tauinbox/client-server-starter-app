import type { OnDestroy, OnInit } from '@angular/core';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_BOTTOM_SHEET_DATA,
  MatBottomSheetRef
} from '@angular/material/bottom-sheet';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { TranslocoDirective } from '@jsverse/transloco';
import { KeyboardShortcutsService } from '@core/services/keyboard-shortcuts.service';
import type { ConfirmDialogData } from './confirm-dialog.component';

@Component({
  selector: 'nxs-confirm-bottom-sheet',
  imports: [MatIcon, MatButton, TranslocoDirective],
  templateUrl: './confirm-bottom-sheet.component.html',
  styleUrl: './confirm-bottom-sheet.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConfirmBottomSheetComponent implements OnInit, OnDestroy {
  readonly bottomSheetRef = inject(
    MatBottomSheetRef<ConfirmBottomSheetComponent>
  );
  readonly data: ConfirmDialogData = inject(MAT_BOTTOM_SHEET_DATA);
  readonly #shortcuts = inject(KeyboardShortcutsService);

  #cleanupSave: (() => void) | null = null;

  ngOnInit(): void {
    this.#cleanupSave = this.#shortcuts.registerSave('', '', () => undefined);
  }

  ngOnDestroy(): void {
    this.#cleanupSave?.();
  }

  cancel(): void {
    this.bottomSheetRef.dismiss(false);
  }

  confirm(): void {
    this.bottomSheetRef.dismiss(true);
  }
}
