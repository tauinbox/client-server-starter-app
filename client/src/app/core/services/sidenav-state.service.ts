import {
  computed,
  effect,
  inject,
  Injectable,
  signal,
  type Signal
} from '@angular/core';
import { AuthStore } from '@features/auth/store/auth.store';
import { canAccessAdminPanel } from '@features/admin/utils/can-access-admin-panel';
import { FeatureFlagsStore } from '@features/feature-flags/store/feature-flags.store';
import { BILLING_FLAG_KEY } from '@app/shared/constants';
import { AppRouteSegmentEnum } from '../../app.route-segment.enum';
import { LayoutService } from './layout.service';
import { LocalStorageService } from './local-storage.service';

const WIDE_KEY = (userId: string) => `sidenav_wide_${userId}`;

// Widths come from the custom properties published in styles/layout/_common.scss
// so the drawer, the content offset and the rail itself share one definition.
const NAV_WIDTH_NARROW = 'var(--nav-width-narrow)';
const NAV_WIDTH_WIDE = 'var(--nav-width-wide)';

export type NavLink = {
  readonly route: string;
  readonly labelKey: string;
  readonly icon: string;
  readonly visible: Signal<boolean>;
};

@Injectable({ providedIn: 'root' })
export class SidenavStateService {
  readonly #storage = inject(LocalStorageService);
  readonly #authStore = inject(AuthStore);
  readonly #layout = inject(LayoutService);
  readonly #flagsStore = inject(FeatureFlagsStore);

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

  readonly #billingEnabled = this.#flagsStore.isEnabled(BILLING_FLAG_KEY);

  readonly #navLinks: readonly NavLink[] = [
    {
      route: `/${AppRouteSegmentEnum.Admin}`,
      labelKey: 'sidenav.adminPanel',
      icon: 'admin_panel_settings',
      visible: computed(() => canAccessAdminPanel(this.#authStore))
    },
    {
      route: `/${AppRouteSegmentEnum.Billing}`,
      labelKey: 'sidenav.billing',
      icon: 'credit_card',
      visible: this.#billingEnabled
    }
  ];

  readonly navLinks = computed(() =>
    this.#navLinks.filter((link) => link.visible())
  );

  // Default post-login landing. Billing is a self-service entry, never the
  // implicit landing target — fall back to the first non-billing nav link
  // (admin panel for admins), else the profile.
  readonly defaultRoute = computed(() => {
    const billingRoute = `/${AppRouteSegmentEnum.Billing}`;
    const target = this.navLinks().find((link) => link.route !== billingRoute);
    return target?.route ?? `/${AppRouteSegmentEnum.Profile}`;
  });

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
