import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { AuthStore } from '@features/auth/store/auth.store';
import { canAccessAdminPanel } from '@features/admin/utils/can-access-admin-panel';
import { LayoutService } from './layout.service';
import { LocalStorageService } from './local-storage.service';

const WIDE_KEY = (userId: string) => `sidenav_wide_${userId}`;

const NAV_WIDTH_NARROW = '4rem';
const NAV_WIDTH_WIDE = '13.75rem';

@Injectable({ providedIn: 'root' })
export class SidenavStateService {
  readonly #storage = inject(LocalStorageService);
  readonly #authStore = inject(AuthStore);
  readonly #layout = inject(LayoutService);

  readonly #isWide = signal(false);
  readonly #mobileOpen = signal(false);

  readonly isWide = this.#isWide.asReadonly();

  // Delegate to LayoutService so all responsive logic funnels through a single
  // source. The API name stays `isMobile` to avoid churn in sidenav callers.
  readonly isMobile = computed(() => this.#layout.isHandset());

  readonly sidenavOpened = computed(() => {
    if (this.isMobile()) return this.#mobileOpen();
    return true;
  });

  readonly width = computed(() =>
    this.#isWide() ? NAV_WIDTH_WIDE : NAV_WIDTH_NARROW
  );

  readonly canAccessAdmin = computed(() =>
    canAccessAdminPanel(this.#authStore)
  );

  constructor() {
    effect(() => {
      const userId = this.#authStore.user()?.id;
      if (userId) {
        this.#isWide.set(
          this.#storage.getItem<boolean>(WIDE_KEY(userId)) ?? false
        );
      } else {
        this.#isWide.set(false);
      }
    });
  }

  toggleWide(): void {
    const next = !this.#isWide();
    this.#isWide.set(next);
    const userId = this.#authStore.user()?.id;
    if (userId) {
      this.#storage.setItem(WIDE_KEY(userId), next);
    }
  }

  toggleMobileOpen(): void {
    this.#mobileOpen.update((v) => !v);
  }

  closeMobile(): void {
    this.#mobileOpen.set(false);
  }
}
