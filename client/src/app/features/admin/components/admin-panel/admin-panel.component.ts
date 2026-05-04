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

  // Mirrors adminPanelGuard's OR-of-three permission check. The guard runs
  // once on navigation; this signal re-evaluates after live RBAC updates
  // (e.g. an admin revokes one of the user's roles via SSE) so we can boot
  // the user out of /admin/* without waiting for their next click.
  protected readonly canAccessAdmin = computed(
    () =>
      this.#authStore.hasPermissions({ action: 'search', subject: 'User' }) ||
      this.#authStore.hasPermissions({ action: 'read', subject: 'Role' }) ||
      this.#authStore.hasPermissions({ action: 'read', subject: 'Permission' })
  );

  constructor() {
    effect(() => {
      if (!this.canAccessAdmin()) {
        void this.#router.navigate([`/${AppRouteSegmentEnum.Forbidden}`]);
      }
    });
  }
}
