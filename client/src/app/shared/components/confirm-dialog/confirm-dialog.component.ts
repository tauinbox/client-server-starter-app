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
  selector: 'app-confirm-dialog',
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

  #cleanupCtrlS: (() => void) | null = null;
  #cleanupMetaS: (() => void) | null = null;

  ngOnInit(): void {
    // Block save shortcuts while confirmation dialog is open so that
    // a form underneath does not accidentally submit via Ctrl+S.
    const noop = () => undefined;
    this.#cleanupCtrlS = this.#shortcuts.register('ctrl+s', '', '', noop);
    this.#cleanupMetaS = this.#shortcuts.register('meta+s', '', '', noop);
  }

  ngOnDestroy(): void {
    this.#cleanupCtrlS?.();
    this.#cleanupMetaS?.();
  }
}
