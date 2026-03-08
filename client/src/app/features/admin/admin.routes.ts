import type { Routes } from '@angular/router';
import { permissionGuard } from '@features/auth/guards/permission.guard';
import { UsersStore } from '@features/users/store/users.store';
import { RolesStore } from './store/roles.store';

export const adminRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/admin-panel/admin-panel.component').then(
        (c) => c.AdminPanelComponent
      ),
    canActivate: [permissionGuard('list', 'User')],
    providers: [UsersStore, RolesStore],
    children: [
      {
        path: '',
        redirectTo: 'users',
        pathMatch: 'full'
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
            canActivate: [permissionGuard('list', 'User')]
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
            canActivate: [permissionGuard('update', 'User')]
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
      }
    ]
  }
];
