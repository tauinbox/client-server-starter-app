import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatTabLink, MatTabNav, MatTabNavPanel } from '@angular/material/tabs';
import { AuthStore } from '@features/auth/store/auth.store';
import { AppRouteSegmentEnum } from '../../../../app.route-segment.enum';

@Component({
  selector: 'app-admin-panel',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatTabNav,
    MatTabLink,
    MatTabNavPanel
  ],
  templateUrl: './admin-panel.component.html',
  styleUrl: './admin-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminPanelComponent {
  protected readonly authStore = inject(AuthStore);
  protected readonly routes = AppRouteSegmentEnum;
}
