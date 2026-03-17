import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthStore } from '@features/auth/store/auth.store';
import { AuthService } from '@features/auth/services/auth.service';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ThemeToggleComponent } from './theme-toggle/theme-toggle.component';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';
import { APP_VERSION, BUILD_HASH, BUILD_DATE } from '@environments/version';
import { environment } from '@environments/environment';

@Component({
  selector: 'app-header',
  imports: [
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    RouterLink,
    RouterLinkActive,
    ThemeToggleComponent
  ],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeaderComponent {
  protected readonly authStore = inject(AuthStore);
  protected readonly routes = AppRouteSegmentEnum;
  protected readonly appName = environment.appName;
  protected readonly appVersion = (() => {
    const date = new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(BUILD_DATE));
    return `v${APP_VERSION} (${BUILD_HASH}) · ${date}`;
  })();

  readonly #authService = inject(AuthService);

  logout(): void {
    this.#authService.logout();
  }
}
