import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  OnInit,
  signal
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
import { UserService } from '../../services/user.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { User } from '../../models/user.types';

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
    DatePipe
  ],
  templateUrl: './user-detail.component.html',
  styleUrl: './user-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserDetailComponent implements OnInit {
  readonly #userService = inject(UserService);
  readonly #snackBar = inject(MatSnackBar);

  readonly id = input.required<string>();
  readonly user = signal<User | null>(null);
  readonly loading = signal(true);

  ngOnInit(): void {
    this.loadUser();
  }

  loadUser(): void {
    this.loading.set(true);

    this.#userService.getById(this.id()).subscribe({
      next: (user) => {
        this.user.set(user);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.#snackBar.open('Failed to load user details. Please try again.', 'Close', { duration: 5000 });
      }
    });
  }
}
