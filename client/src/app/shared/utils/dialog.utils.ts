import type { MatDialogConfig } from '@angular/material/dialog';
import { rem } from './css.utils';

/**
 * Standard dialog size presets.
 *
 * Keep in sync with the size comments in
 * `client/src/styles/components/_dialogs.scss`.
 */
export enum DialogSize {
  /** Yes/no confirmations and simple alerts. ~350px */
  Confirm = 'confirm',
  /** Single-entity forms (create / edit). ~480px */
  Form = 'form',
  /** Rich / multi-section dialogs. 90vw, max ~1000px */
  Wide = 'wide'
}

// All sizes use { width: '90vw', maxWidth } so the dialog scales down on small
// viewports instead of overflowing. A fixed `width` alone would override
// Material's built-in calc(100vw - 32px) mobile breakpoint rule.
//
// Values are aligned with Material Design 3 and cross-system standards:
//   Confirm → 400px  (M3 min 280px, industry confirm range 280–400px)
//   Form    → 560px  (M3 standard form max)
//   Wide    → 1000px (two-column / rich admin dialogs)
const DIALOG_CONFIG: Record<
  DialogSize,
  Pick<MatDialogConfig, 'width' | 'maxWidth'>
> = {
  [DialogSize.Confirm]: { width: '90vw', maxWidth: rem(400) },
  [DialogSize.Form]: { width: '90vw', maxWidth: rem(560) },
  [DialogSize.Wide]: { width: '90vw', maxWidth: rem(1000) }
};

/**
 * Returns the MatDialogConfig size options for a given preset.
 *
 * Usage:
 * ```ts
 * this.#dialog.open(MyDialogComponent, { ...dialogSizeConfig(DialogSize.Form), data });
 * ```
 */
export const dialogSizeConfig = (
  size: DialogSize
): Pick<MatDialogConfig, 'width' | 'maxWidth'> => DIALOG_CONFIG[size];
