import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const adminGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated() && authService.isAdmin()) {
    return true;
  }

  if (!authService.isAuthenticated()) {
    void router.navigate(['/login'], {
      queryParams: { returnUrl: state.url }
    });
  } else {
    // User is authenticated but not an admin
    void router.navigate(['/forbidden']);
  }

  return false;
};
