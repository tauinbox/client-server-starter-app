import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
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
import { APP_VERSION, BUILD_HASH, BUILD_DATE } from '@environments/version';
import { environment } from '@environments/environment';
import { SidenavStateService } from '@core/services/sidenav-state.service';
import { LanguageService } from '@core/services/language.service';

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
  readonly #language = inject(LanguageService).language;
  protected readonly appName = environment.appName;

  // Intl rather than Angular's formatDate: the build date must follow the
  // language the user picked at runtime, and Intl needs no locale data to be
  // registered up front (LanguageService imports it lazily).
  protected readonly appVersion = computed(() => {
    const builtAt = new Intl.DateTimeFormat(this.#language(), {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(BUILD_DATE));
    return `v${APP_VERSION} (${BUILD_HASH}) · ${builtAt}`;
  });

  readonly #authService = inject(AuthService);

  logout(): void {
    this.#authService.logout();
  }
}
