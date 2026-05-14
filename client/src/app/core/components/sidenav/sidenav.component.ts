import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatRippleModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslocoDirective } from '@jsverse/transloco';
import { SidenavStateService } from '@core/services/sidenav-state.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';

@Component({
  selector: 'nxs-sidenav',
  imports: [
    RouterLink,
    RouterLinkActive,
    MatRippleModule,
    MatIconModule,
    MatTooltipModule,
    TranslocoDirective
  ],
  templateUrl: './sidenav.component.html',
  styleUrl: './sidenav.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SidenavComponent {
  protected readonly sidenavState = inject(SidenavStateService);
  protected readonly authStore = inject(AuthStore);
  protected readonly routes = AppRouteSegmentEnum;
}
