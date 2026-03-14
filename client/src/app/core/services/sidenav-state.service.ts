import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { AuthStore } from '@features/auth/store/auth.store';
import { LocalStorageService } from './local-storage.service';

const WIDE_KEY = (userId: string) => `sidenav_wide_${userId}`;

const NAV_WIDTH_NARROW = '4rem';
const NAV_WIDTH_WIDE = '13.75rem';

@Injectable({ providedIn: 'root' })
export class SidenavStateService {
  readonly #storage = inject(LocalStorageService);
  readonly #authStore = inject(AuthStore);

  readonly #isWide = signal(false);

  readonly isWide = this.#isWide.asReadonly();

  readonly width = computed(() =>
    this.#isWide() ? NAV_WIDTH_WIDE : NAV_WIDTH_NARROW
  );

  readonly canAccessAdmin = computed(
    () =>
      this.#authStore.hasPermissions({ action: 'search', subject: 'User' }) ||
      this.#authStore.hasPermissions({ action: 'read', subject: 'Role' }) ||
      this.#authStore.hasPermissions({ action: 'read', subject: 'Permission' })
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
}
