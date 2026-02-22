import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { MatButton, MatIconButton } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatChip } from '@angular/material/chips';
import { MatDivider } from '@angular/material/divider';
import { UsersStore } from '../../store/users.store';
import { RequirePermissionDirective } from '../../../auth/directives/require-permission.directive';

@Component({
  selector: 'app-user-detail',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatIconButton,
    RouterLink,
    MatIcon,
    MatCardContent,
    MatProgressSpinner,
    MatChip,
    MatDivider,
    MatButton,
    DatePipe,
    RequirePermissionDirective
  ],
  templateUrl: './user-detail.component.html',
  styleUrl: './user-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserDetailComponent implements OnInit {
  readonly #usersStore = inject(UsersStore);

  readonly id = input.required<string>();
  readonly user = computed(
    () => this.#usersStore.entityMap()[this.id()] ?? null
  );
  readonly loading = this.#usersStore.detailLoading;

  ngOnInit(): void {
    this.#usersStore.loadOne(this.id());
  }
}
