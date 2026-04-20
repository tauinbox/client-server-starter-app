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
import { AuthStore } from '@features/auth/store/auth.store';

export const adminRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/admin-panel/admin-panel.component').then(
        (c) => c.AdminPanelComponent
      ),
    canActivate: [adminPanelGuard],
    providers: [UsersStore, RolesStore, ResourcesStore],
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
          return 'resources';
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
      }
    ]
  }
];
