import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import {
  MatCard,
  MatCardAvatar,
  MatCardContent,
  MatCardSubtitle,
  MatCardTitle
} from '@angular/material/card';
import { MatChip, MatChipAvatar } from '@angular/material/chips';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import {
  MatMenu,
  MatMenuContent,
  MatMenuItem,
  MatMenuTrigger
} from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { TranslocoDirective } from '@jsverse/transloco';
import {
  isAdminRole,
  roleIcon,
  sortRolesForDisplay
} from '@shared/utils/role-display.utils';
import { RequirePermissionsDirective } from '../../../auth/directives/require-permissions.directive';
import type { User } from '../../models/user.types';

@Component({
  selector: 'nxs-user-card-list',
  imports: [
    MatCard,
    MatCardAvatar,
    MatCardTitle,
    MatCardSubtitle,
    MatCardContent,
    MatChip,
    MatChipAvatar,
    MatIcon,
    MatIconButton,
    MatMenu,
    MatMenuContent,
    MatMenuItem,
    MatMenuTrigger,
    MatTooltip,
    RouterLink,
    DatePipe,
    TranslocoDirective,
    RequirePermissionsDirective
  ],
  templateUrl: './user-card-list.component.html',
  styleUrl: './user-card-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserCardListComponent {
  readonly users = input.required<User[]>();

  readonly deleteUser = output<User>();

  protected readonly roleIcon = roleIcon;
  protected readonly isAdminRole = isAdminRole;

  trackById(_index: number, user: User): string {
    return user.id;
  }

  sortedRoles(user: User): User['roles'] {
    return sortRolesForDisplay(user.roles);
  }
}
