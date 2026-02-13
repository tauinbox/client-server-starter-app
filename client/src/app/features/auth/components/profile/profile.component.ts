import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal
} from '@angular/core';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle
} from '@angular/material/card';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatDivider } from '@angular/material/divider';
import type { FormControl, FormGroup } from '@angular/forms';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon, MatIconRegistry } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatButton, MatIconButton } from '@angular/material/button';
import { AuthService } from '../../services/auth.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { User } from '@shared/models/user.types';
import type { UpdateProfile } from '../../models/auth.types';
import { DatePipe } from '@angular/common';
import type { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { OAUTH_URLS } from '../../constants/auth-api.const';

type ProfileFormType = {
  firstName: FormControl<string>;
  lastName: FormControl<string>;
  password: FormControl<string>;
};

type OAuthAccountInfo = {
  provider: string;
  createdAt: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  facebook: 'Facebook',
  vk: 'VK'
};

@Component({
  selector: 'app-profile',
  imports: [
    MatCard,
    MatCardHeader,
    MatCardContent,
    MatCardTitle,
    MatError,
    MatLabel,
    MatProgressSpinner,
    MatDivider,
    ReactiveFormsModule,
    MatFormField,
    MatIcon,
    MatInput,
    MatIconButton,
    MatButton,
    DatePipe
  ],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProfileComponent implements OnInit {
  readonly #fb = inject(FormBuilder);
  readonly #authService = inject(AuthService);
  readonly #snackBar = inject(MatSnackBar);
  readonly #destroyRef = inject(DestroyRef);

  protected readonly user = signal<User | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);
  protected readonly oauthAccounts = signal<OAuthAccountInfo[]>([]);
  protected readonly oauthLoading = signal(false);
  protected readonly allProviders = Object.keys(OAUTH_URLS);
  protected readonly providerLabels = PROVIDER_LABELS;

  protected readonly profileForm: FormGroup<ProfileFormType> =
    this.#fb.group<ProfileFormType>({
      firstName: this.#fb.control('', {
        validators: [Validators.required],
        nonNullable: true
      }),
      lastName: this.#fb.control('', {
        validators: [Validators.required],
        nonNullable: true
      }),
      password: this.#fb.control('', {
        validators: [Validators.minLength(8)],
        nonNullable: true
      })
    });

  constructor() {
    const iconRegistry = inject(MatIconRegistry);
    const sanitizer = inject(DomSanitizer);

    iconRegistry.addSvgIcon(
      'google',
      sanitizer.bypassSecurityTrustResourceUrl('/assets/icons/google.svg')
    );
    iconRegistry.addSvgIcon(
      'facebook',
      sanitizer.bypassSecurityTrustResourceUrl('/assets/icons/facebook.svg')
    );
    iconRegistry.addSvgIcon(
      'vk',
      sanitizer.bypassSecurityTrustResourceUrl('/assets/icons/vk.svg')
    );
  }

  ngOnInit() {
    this.loadProfile();
    this.loadOAuthAccounts();
  }

  loadProfile(): void {
    this.loading.set(true);
    this.error.set(null);

    this.#authService
      .getProfile()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (user) => {
          this.user.set(user);
          this.profileForm.patchValue({
            firstName: user.firstName,
            lastName: user.lastName,
            password: ''
          });
          this.loading.set(false);
          this.profileForm.markAsPristine();
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          const errorMessage =
            err.error?.message || 'Failed to load profile. Please try again.';
          this.error.set(errorMessage);
        }
      });
  }

  loadOAuthAccounts(): void {
    this.#authService
      .getOAuthAccounts()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (accounts) => this.oauthAccounts.set(accounts),
        error: () => this.oauthAccounts.set([])
      });
  }

  isProviderLinked(provider: string): boolean {
    return this.oauthAccounts().some((a) => a.provider === provider);
  }

  connectProvider(provider: string): void {
    sessionStorage.setItem('oauth_return_url', '/profile');
    window.location.href = OAUTH_URLS[provider as keyof typeof OAUTH_URLS];
  }

  disconnectProvider(provider: string): void {
    this.oauthLoading.set(true);
    this.#authService
      .unlinkOAuthAccount(provider)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.oauthLoading.set(false);
          this.oauthAccounts.update((accounts) =>
            accounts.filter((a) => a.provider !== provider)
          );
          this.#snackBar.open(
            `${PROVIDER_LABELS[provider] || provider} account disconnected`,
            'Close',
            { duration: 5000 }
          );
        },
        error: (err: HttpErrorResponse) => {
          this.oauthLoading.set(false);
          this.#snackBar.open(
            err.error?.message || 'Failed to disconnect account',
            'Close',
            { duration: 5000 }
          );
        }
      });
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((prev) => !prev);
  }

  onSubmit(): void {
    if (this.profileForm.invalid || !this.user()) return;

    const formValues = this.profileForm.getRawValue();

    const updateData: UpdateProfile = {
      firstName: formValues.firstName,
      lastName: formValues.lastName
    };

    if (formValues.password.trim()) {
      updateData.password = formValues.password;
    }

    this.saving.set(true);
    this.error.set(null);

    this.#authService
      .updateProfile(updateData)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (updatedUser) => {
          this.saving.set(false);
          this.user.set(updatedUser);

          this.profileForm.patchValue({ password: '' });
          this.profileForm.markAsPristine();

          this.#snackBar.open('Profile updated successfully', 'Close', {
            duration: 5000
          });
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          const errorMessage =
            err.error?.message || 'Failed to update profile. Please try again.';
          this.error.set(errorMessage);
        }
      });
  }
}
