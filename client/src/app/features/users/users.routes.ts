import type { Routes } from '@angular/router';
import { permissionGuard } from '@features/auth/guards/permission.guard';

export const userRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/user-list/user-list.component').then(
        (c) => c.UserListComponent
      ),
    canActivate: [permissionGuard('search', 'User')]
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./components/user-detail/user-detail.component').then(
        (c) => c.UserDetailComponent
      ),
    canActivate: [permissionGuard('read', 'User')]
  },
  {
    path: ':id/edit',
    loadComponent: () =>
      import('./components/user-edit/user-edit.component').then(
        (c) => c.UserEditComponent
      ),
    canActivate: [permissionGuard('update', 'User')]
  }
];
