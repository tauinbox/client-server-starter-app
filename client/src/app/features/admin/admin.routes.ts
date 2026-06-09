import { inject } from '@angular/core';
import type { Routes } from '@angular/router';
import {
  instancePermissionGuard,
  permissionGuard
} from '@features/auth/guards/permission.guard';
import { adminPanelGuard } from './guards/admin-panel.guard';
import { UsersStore } from '@features/users/store/users.store';
import { RolesStore } from './store/roles.store';
import { ResourcesStore } from './store/resources.store';
import { FeatureFlagsAdminStore } from './store/feature-flags-admin.store';
import { BillingAdminStore } from './store/billing-admin.store';
import { AuthStore } from '@features/auth/store/auth.store';

export const adminRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/admin-panel/admin-panel.component').then(
        (c) => c.AdminPanelComponent
      ),
    canActivate: [adminPanelGuard],
    providers: [
      UsersStore,
      RolesStore,
      ResourcesStore,
      FeatureFlagsAdminStore,
      BillingAdminStore
    ],
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: () => {
          const authStore = inject(AuthStore);
          if (authStore.hasPermissions({ action: 'search', subject: 'User' }))
            return 'users';
          if (authStore.hasPermissions({ action: 'read', subject: 'Role' }))
            return 'roles';
          if (
            authStore.hasPermissions({ action: 'read', subject: 'Permission' })
          )
            return 'resources';
          return 'feature-flags';
        }
      },
      {
        path: 'users',
        children: [
          {
            path: '',
            loadComponent: () =>
              import('@features/users/components/user-list/user-list.component').then(
                (c) => c.UserListComponent
              ),
            canActivate: [permissionGuard('search', 'User')]
          },
          {
            path: ':id',
            loadComponent: () =>
              import('@features/users/components/user-detail/user-detail.component').then(
                (c) => c.UserDetailComponent
              ),
            canActivate: [permissionGuard('read', 'User')]
          },
          {
            path: ':id/edit',
            loadComponent: () =>
              import('@features/users/components/user-edit/user-edit.component').then(
                (c) => c.UserEditComponent
              ),
            canActivate: [
              instancePermissionGuard('update', 'User', (route) => ({
                id: route.params['id']
              }))
            ]
          },
          {
            path: ':id/permissions',
            loadComponent: () =>
              import('@features/users/components/user-permissions/user-permissions.component').then(
                (c) => c.UserPermissionsComponent
              ),
            canActivate: [permissionGuard('read', 'User')]
          }
        ]
      },
      {
        path: 'roles',
        loadComponent: () =>
          import('./components/roles/role-list/role-list.component').then(
            (c) => c.RoleListComponent
          ),
        canActivate: [permissionGuard('read', 'Role')]
      },
      {
        path: 'resources',
        loadComponent: () =>
          import('./components/resources/resource-list/resource-list.component').then(
            (c) => c.ResourceListComponent
          ),
        canActivate: [permissionGuard('read', 'Permission')]
      },
      {
        path: 'actions',
        loadComponent: () =>
          import('./components/resources/action-list/action-list.component').then(
            (c) => c.ActionListComponent
          ),
        canActivate: [permissionGuard('read', 'Permission')]
      },
      {
        path: 'feature-flags',
        loadComponent: () =>
          import('./components/feature-flags/feature-flag-list/feature-flag-list.component').then(
            (c) => c.FeatureFlagListComponent
          ),
        canActivate: [permissionGuard('manage', 'FeatureFlag')]
      },
      {
        path: 'billing',
        loadComponent: () =>
          import('./components/billing/billing-admin-list.component').then(
            (c) => c.BillingAdminListComponent
          ),
        canActivate: [permissionGuard('manage', 'Billing')]
      }
    ]
  }
];
