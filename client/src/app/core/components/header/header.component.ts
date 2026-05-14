import {
  ChangeDetectionStrategy,
  Component,
  inject,
  LOCALE_ID
} from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthStore } from '@features/auth/store/auth.store';
import { AuthService } from '@features/auth/services/auth.service';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ThemeToggleComponent } from './theme-toggle/theme-toggle.component';
import { LanguageSwitcherComponent } from './language-switcher/language-switcher.component';
import { TranslocoDirective } from '@jsverse/transloco';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { formatDate } from '@angular/common';
import { APP_VERSION, BUILD_HASH, BUILD_DATE } from '@environments/version';
import { environment } from '@environments/environment';
import { SidenavStateService } from '@core/services/sidenav-state.service';

@Component({
  selector: 'nxs-header',
  imports: [
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    RouterLink,
    RouterLinkActive,
    ThemeToggleComponent,
    LanguageSwitcherComponent,
    TranslocoDirective
  ],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeaderComponent {
  protected readonly authStore = inject(AuthStore);
  protected readonly sidenavState = inject(SidenavStateService);
  protected readonly routes = AppRouteSegmentEnum;
  readonly #locale = inject(LOCALE_ID);
  protected readonly appName = environment.appName;
  protected readonly appVersion = `v${APP_VERSION} (${BUILD_HASH}) · ${formatDate(BUILD_DATE, 'short', this.#locale)}`;

  readonly #authService = inject(AuthService);

  logout(): void {
    this.#authService.logout();
  }
}
