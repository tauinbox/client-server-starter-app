import { inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { AuthStore } from '../store/auth.store';
import { FeatureFlagsStore } from '@features/feature-flags/store/feature-flags.store';

/**
 * The bootstrap initializer. The access token lives in memory only, so a
 * bootstrap never holds one: a persisted user means a page reload, and the
 * session is restored through the refresh cookie.
 */
export async function restoreSession(): Promise<void> {
  const authService = inject(AuthService);
  const authStore = inject(AuthStore);
  const featureFlagsStore = inject(FeatureFlagsStore);
  if (authStore.hasPersistedUser()) {
    try {
      await firstValueFrom(authService.refreshTokens());
      await authService.completeAuthentication();
    } catch {
      authService.clearSession();
    }
  } else {
    // Anonymous bootstrap: still load public flags so the landing page
    // can render `*nxsHasFeature` placeholders for public previews.
    void featureFlagsStore.load();
  }
}
