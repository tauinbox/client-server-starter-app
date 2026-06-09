import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject
} from '@angular/core';
import {
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet
} from '@angular/router';
import { MatTabLink, MatTabNav, MatTabNavPanel } from '@angular/material/tabs';
import { TranslocoDirective } from '@jsverse/transloco';
import { BILLING_FLAG_KEY } from '@app/shared/constants';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { RequirePermissionsDirective } from '@features/auth/directives/require-permissions.directive';
import { AuthStore } from '@features/auth/store/auth.store';
import { FeatureFlagsStore } from '@features/feature-flags/store/feature-flags.store';
import { canAccessAdminPanel } from '../../utils/can-access-admin-panel';

@Component({
  selector: 'nxs-admin-panel',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatTabNav,
    MatTabLink,
    MatTabNavPanel,
    RequirePermissionsDirective,
    TranslocoDirective
  ],
  templateUrl: './admin-panel.component.html',
  styleUrl: './admin-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminPanelComponent {
  readonly #authStore = inject(AuthStore);
  readonly #router = inject(Router);
  readonly #flagsStore = inject(FeatureFlagsStore);

  protected readonly routes = AppRouteSegmentEnum;

  // The billing admin tab is hidden when billing is unavailable (design §18.3):
  // the public `billing` flag resolves false when no provider is configured.
  protected readonly billingAvailable =
    this.#flagsStore.isEnabled(BILLING_FLAG_KEY);

  // Route guard runs only on navigation; this re-evaluates after live RBAC
  // updates so the user is booted from /admin/* the moment they lose access.
  protected readonly canAccessAdmin = computed(() =>
    canAccessAdminPanel(this.#authStore)
  );

  constructor() {
    // isAuthenticated() gate avoids a /forbidden flash during logout, where
    // accessToken and ability are nulled together.
    effect(() => {
      if (this.#authStore.isAuthenticated() && !this.canAccessAdmin()) {
        void this.#router.navigate([`/${AppRouteSegmentEnum.Forbidden}`]);
      }
    });
  }
}
