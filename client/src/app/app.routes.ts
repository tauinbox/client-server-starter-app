import type { Routes } from '@angular/router';
import { authGuard } from '@features/auth/guards/auth.guard';
import { permissionGuard } from '@features/auth/guards/permission.guard';
import { guestGuard } from '@features/auth/guards/guest.guard';
import { PERMISSIONS } from '@app/shared/constants';
import { AppRouteSegmentEnum } from './app.route-segment.enum';
import { UsersStore } from '@features/users/store/users.store';

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
    path: AppRouteSegmentEnum.Users,
    providers: [UsersStore],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/users/components/user-list/user-list.component').then(
            (c) => c.UserListComponent
          ),
        canActivate: [permissionGuard(PERMISSIONS.USERS_LIST)]
      },
      {
        path: 'search',
        loadComponent: () =>
          import('./features/users/components/user-search/user-search.component').then(
            (c) => c.UserSearchComponent
          ),
        canActivate: [permissionGuard(PERMISSIONS.USERS_SEARCH)]
      },
      {
        path: ':id',
        loadComponent: () =>
          import('./features/users/components/user-detail/user-detail.component').then(
            (c) => c.UserDetailComponent
          ),
        canActivate: [authGuard]
      },
      {
        path: ':id/edit',
        loadComponent: () =>
          import('./features/users/components/user-edit/user-edit.component').then(
            (c) => c.UserEditComponent
          ),
        canActivate: [authGuard]
      }
    ]
  },
  {
    path: AppRouteSegmentEnum.OAuthCallback,
    loadComponent: () =>
      import('./features/auth/components/oauth-callback/oauth-callback.component').then(
        (c) => c.OAuthCallbackComponent
      )
  },
  {
    path: AppRouteSegmentEnum.Feature,
    loadComponent: () =>
      import('./features/feature/feature.component').then(
        (c) => c.FeatureComponent
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
