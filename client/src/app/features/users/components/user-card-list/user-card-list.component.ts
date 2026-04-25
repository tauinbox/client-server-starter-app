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
  MatCardHeader,
  MatCardSubtitle,
  MatCardTitle
} from '@angular/material/card';
import { MatChip } from '@angular/material/chips';
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
import { SYSTEM_ROLES } from '@app/shared/constants';
import { RequirePermissionsDirective } from '../../../auth/directives/require-permissions.directive';
import type { User } from '../../models/user.types';

@Component({
  selector: 'app-user-card-list',
  imports: [
    MatCard,
    MatCardAvatar,
    MatCardHeader,
    MatCardTitle,
    MatCardSubtitle,
    MatCardContent,
    MatChip,
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

  trackById(_index: number, user: User): string {
    return user.id;
  }

  isAdmin(user: User): boolean {
    return user.roles?.some((r) => r.name === SYSTEM_ROLES.ADMIN) ?? false;
  }
}
