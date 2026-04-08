import type { ApplicationConfig } from '@angular/core';
import {
  inject,
  isDevMode,
  provideAppInitializer,
  provideZoneChangeDetection
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideTransloco } from '@jsverse/transloco';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MAT_SNACK_BAR_DEFAULT_OPTIONS } from '@angular/material/snack-bar';
import { MAT_TOOLTIP_DEFAULT_OPTIONS } from '@angular/material/tooltip';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { jwtInterceptor } from '@features/auth/interceptors/jwt.interceptor';
import { errorInterceptor } from '@core/interceptors/error.interceptor';
import { AuthService } from '@features/auth/services/auth.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { registerOAuthIcons } from '@features/auth/utils/register-oauth-icons';
import { NotificationsService } from '@core/services/notifications.service';
import { TranslocoHttpLoader } from '@core/transloco-loader';
import { LanguageService } from '@core/services/language.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    // Error interceptor must be registered before JWT interceptor:
    // JWT handles 401s (refresh + retry), error interceptor handles everything else
    provideHttpClient(withInterceptors([errorInterceptor, jwtInterceptor])),
    provideAppInitializer(() => {
      const iconRegistry = inject(MatIconRegistry);
      const sanitizer = inject(DomSanitizer);
      registerOAuthIcons(iconRegistry, sanitizer);
      for (const lang of ['en', 'ru']) {
        iconRegistry.addSvgIcon(
          `flag-${lang}`,
          sanitizer.bypassSecurityTrustResourceUrl(
            `assets/icons/flags/${lang}.svg`
          )
        );
      }
    }),
    provideAppInitializer(async () => {
      const authService = inject(AuthService);
      const authStore = inject(AuthStore);
      const notificationsService = inject(NotificationsService);
      if (authService.isAuthenticated()) {
        authService.scheduleTokenRefresh();
        await Promise.all([
          authService.fetchPermissions(),
          authService.fetchRbacMetadata()
        ]);
        notificationsService.connect();
      } else if (authStore.hasPersistedUser()) {
        // Page reload: access token gone from memory, try to restore via refresh cookie
        try {
          await firstValueFrom(authService.refreshTokens());
          await Promise.all([
            authService.fetchPermissions(),
            authService.fetchRbacMetadata()
          ]);
          notificationsService.connect();
        } catch {
          authStore.clearSession();
        }
      }
    }),
    provideTransloco({
      config: {
        availableLangs: ['en', 'ru'],
        defaultLang: 'en',
        reRenderOnLangChange: true,
        prodMode: !isDevMode()
      },
      loader: TranslocoHttpLoader
    }),
    provideAppInitializer(() => {
      inject(LanguageService);
    }),
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'outline' }
    },
    {
      provide: MAT_TOOLTIP_DEFAULT_OPTIONS,
      useValue: { showDelay: 0, hideDelay: 0, touchendHideDelay: 1500 }
    },
    {
      provide: MAT_SNACK_BAR_DEFAULT_OPTIONS,
      useValue: {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      }
    }
  ]
};
