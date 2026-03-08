import type { Routes } from '@angular/router';
import { authGuard } from '@features/auth/guards/auth.guard';
import { guestGuard } from '@features/auth/guards/guest.guard';
import { AppRouteSegmentEnum } from './app.route-segment.enum';

export const routes: Routes = [
  {
    path: '',
    redirectTo: AppRouteSegmentEnum.Profile,
    pathMatch: 'full'
  },
  {
    path: AppRouteSegmentEnum.Login,
    loadComponent: () =>
      import('./features/auth/components/login/login.component').then(
        (c) => c.LoginComponent
      ),
    canActivate: [guestGuard]
  },
  {
    path: AppRouteSegmentEnum.Register,
    loadComponent: () =>
      import('./features/auth/components/register/register.component').then(
        (c) => c.RegisterComponent
      ),
    canActivate: [guestGuard]
  },
  {
    path: AppRouteSegmentEnum.Profile,
    loadComponent: () =>
      import('./features/auth/components/profile/profile.component').then(
        (c) => c.ProfileComponent
      ),
    canActivate: [authGuard]
  },
  {
    path: AppRouteSegmentEnum.Admin,
    loadChildren: () =>
      import('./features/admin/admin.routes').then((r) => r.adminRoutes)
  },
  {
    path: AppRouteSegmentEnum.OAuthCallback,
    loadComponent: () =>
      import('./features/auth/components/oauth-callback/oauth-callback.component').then(
        (c) => c.OAuthCallbackComponent
      )
  },
  {
    path: AppRouteSegmentEnum.VerifyEmail,
    loadComponent: () =>
      import('./features/auth/components/verify-email/verify-email.component').then(
        (c) => c.VerifyEmailComponent
      )
  },
  {
    path: AppRouteSegmentEnum.ForgotPassword,
    loadComponent: () =>
      import('./features/auth/components/forgot-password/forgot-password.component').then(
        (c) => c.ForgotPasswordComponent
      ),
    canActivate: [guestGuard]
  },
  {
    path: AppRouteSegmentEnum.ResetPassword,
    loadComponent: () =>
      import('./features/auth/components/reset-password/reset-password.component').then(
        (c) => c.ResetPasswordComponent
      ),
    canActivate: [guestGuard]
  },
  {
    path: AppRouteSegmentEnum.Forbidden,
    loadComponent: () =>
      import('./features/auth/components/forbidden/forbidden.component').then(
        (c) => c.ForbiddenComponent
      )
  },
  {
    path: AppRouteSegmentEnum.Any,
    loadComponent: () =>
      import('./core/components/page-not-found/page-not-found.component').then(
        (c) => c.PageNotFoundComponent
      )
  }
];
