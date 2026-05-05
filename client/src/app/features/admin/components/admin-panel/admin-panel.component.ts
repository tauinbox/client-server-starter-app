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
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';
import { RequirePermissionsDirective } from '@features/auth/directives/require-permissions.directive';
import { AuthStore } from '@features/auth/store/auth.store';
import { canAccessAdminPanel } from '../../utils/can-access-admin-panel';

@Component({
  selector: 'app-admin-panel',
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

  protected readonly routes = AppRouteSegmentEnum;

  // The guard runs once on navigation; this signal re-evaluates after live
  // RBAC updates (e.g. an admin revokes one of the user's roles via SSE) so
  // we can boot the user out of /admin/* without waiting for their next click.
  protected readonly canAccessAdmin = computed(() =>
    canAccessAdminPanel(this.#authStore)
  );

  constructor() {
    effect(() => {
      if (!this.canAccessAdmin()) {
        void this.#router.navigate([`/${AppRouteSegmentEnum.Forbidden}`]);
      }
    });
  }
}
