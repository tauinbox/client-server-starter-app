import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import {
  MatCell,
  MatCellDef,
  MatColumnDef,
  MatHeaderCell,
  MatHeaderCellDef,
  MatHeaderRow,
  MatHeaderRowDef,
  MatRow,
  MatRowDef,
  MatTable
} from '@angular/material/table';
import type { Sort, SortDirection } from '@angular/material/sort';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIconButton } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { MatChip, MatChipAvatar } from '@angular/material/chips';
import { MatIcon } from '@angular/material/icon';
import { TranslocoDirective } from '@jsverse/transloco';
import { LocalizedDatePipe } from '@shared/pipes/localized-date.pipe';
import {
  isAdminRole,
  overflowRoleNames,
  roleIcon,
  sortRolesForDisplay
} from '@shared/utils/role-display.utils';
import { RequirePermissionsDirective } from '../../../auth/directives/require-permissions.directive';
import type { User, UserSortColumn } from '../../models/user.types';

export const COLUMN_TO_SORT_MAP: Record<string, UserSortColumn> = {
  email: 'email',
  name: 'firstName',
  status: 'isActive',
  createdAt: 'createdAt'
};

export const SORT_TO_COLUMN_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(COLUMN_TO_SORT_MAP).map(([column, sortBy]) => [sortBy, column])
);

@Component({
  selector: 'nxs-user-table',
  imports: [
    MatTable,
    MatSort,
    MatSortHeader,
    MatColumnDef,
    MatHeaderCell,
    MatHeaderCellDef,
    MatCell,
    MatCellDef,
    MatTooltip,
    MatIconButton,
    RouterLink,
    MatChip,
    MatChipAvatar,
    MatIcon,
    MatHeaderRow,
    MatRow,
    MatHeaderRowDef,
    MatRowDef,
    LocalizedDatePipe,
    TranslocoDirective,
    RequirePermissionsDirective
  ],
  templateUrl: './user-table.component.html',
  styleUrl: './user-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserTableComponent {
  readonly users = input.required<User[]>();
  /** The sorted column; empty for the default sort, which marks none. */
  readonly sortActive = input('');
  readonly sortDirection = input<SortDirection>('');

  readonly sortChange = output<Sort>();
  readonly deleteUser = output<User>();
  readonly restoreUser = output<User>();

  readonly displayedColumns: string[] = [
    'id',
    'email',
    'name',
    'status',
    'role',
    'createdAt',
    'actions'
  ];

  protected readonly roleIcon = roleIcon;
  protected readonly isAdminRole = isAdminRole;
  protected readonly overflowRoleNames = overflowRoleNames;

  trackById(_index: number, user: User): string {
    return user.id;
  }

  sortedRoles(user: User): User['roles'] {
    return sortRolesForDisplay(user.roles);
  }
}
