import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthStore } from '../store/auth.store';
import { AuthService } from '../services/auth.service';
import { AppRouteSegmentEnum } from '../../../app.route-segment.enum';

export const guestGuard: CanActivateFn = () => {
  const authStore = inject(AuthStore);
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authStore.isAuthenticated()) {
    return true;
  }

  // Token is valid — redirect to profile
  if (!authStore.isAccessTokenExpired()) {
    void router.navigate([`/${AppRouteSegmentEnum.Profile}`]);
    return false;
  }

  // Token expired — attempt refresh before deciding
  return authService.refreshTokens().pipe(
    map((tokens) => {
      if (tokens) {
        void router.navigate([`/${AppRouteSegmentEnum.Profile}`]);
        return false;
      }

      authStore.clearSession();
      return true;
    }),
    catchError(() => {
      authStore.clearSession();
      return of(true);
    })
  );
};
