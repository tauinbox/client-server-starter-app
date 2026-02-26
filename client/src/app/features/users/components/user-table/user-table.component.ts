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
import type { Sort } from '@angular/material/sort';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIconButton } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { MatChip } from '@angular/material/chips';
import { MatIcon } from '@angular/material/icon';
import { DatePipe } from '@angular/common';
import type { User, UserSortColumn } from '../../models/user.types';

export const COLUMN_TO_SORT_MAP: Record<string, UserSortColumn> = {
  email: 'email',
  name: 'firstName',
  status: 'isActive',
  createdAt: 'createdAt'
};

@Component({
  selector: 'app-user-table',
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
    MatIcon,
    MatHeaderRow,
    MatRow,
    MatHeaderRowDef,
    MatRowDef,
    DatePipe
  ],
  templateUrl: './user-table.component.html',
  styleUrl: './user-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserTableComponent {
  readonly users = input.required<User[]>();

  readonly sortChange = output<Sort>();
  readonly deleteUser = output<User>();

  readonly displayedColumns: string[] = [
    'id',
    'email',
    'name',
    'status',
    'role',
    'createdAt',
    'actions'
  ];

  trackById(_index: number, user: User): string {
    return user.id;
  }
}
