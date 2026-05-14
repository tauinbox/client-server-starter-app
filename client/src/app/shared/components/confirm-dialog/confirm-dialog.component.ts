import type { OnDestroy, OnInit } from '@angular/core';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle
} from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { TranslocoDirective } from '@jsverse/transloco';
import { KeyboardShortcutsService } from '@core/services/keyboard-shortcuts.service';

export type ConfirmDialogData = {
  title: string;
  message: string;
  confirmButton: string;
  cancelButton: string;
  icon?: string;
};

@Component({
  selector: 'nxs-confirm-dialog',
  imports: [
    MatDialogContent,
    MatDialogTitle,
    MatIcon,
    MatDialogActions,
    MatButton,
    MatDialogClose,
    TranslocoDirective
  ],
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConfirmDialogComponent implements OnInit, OnDestroy {
  readonly dialogRef = inject(MatDialogRef<ConfirmDialogComponent>);
  readonly data: ConfirmDialogData = inject(MAT_DIALOG_DATA);
  readonly #shortcuts = inject(KeyboardShortcutsService);

  #cleanupSave: (() => void) | null = null;

  ngOnInit(): void {
    // Block save shortcut while confirmation dialog is open so that
    // a form underneath does not accidentally submit via Ctrl+S / Cmd+S.
    this.#cleanupSave = this.#shortcuts.registerSave('', '', () => undefined);
  }

  ngOnDestroy(): void {
    this.#cleanupSave?.();
  }
}
