import type { Provider } from '@angular/core';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';

/**
 * Disables the Angular Material animations in a test, so that a dialog,
 * a menu or a snackbar opens and closes synchronously.
 */
export function provideNoopMaterialAnimations(): Provider {
  return {
    provide: MATERIAL_ANIMATIONS,
    useValue: { animationsDisabled: true }
  };
}
