import type { OnDestroy, OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatCheckbox } from '@angular/material/checkbox';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { of, Subject } from 'rxjs';
import type { FeatureFlagPreviewResult } from '@app/shared/types';
import {
  NxsChipsAutocompleteComponent,
  type ChipOption
} from '@shared/forms/nxs-chips-autocomplete/nxs-chips-autocomplete.component';
import { NotifyService } from '@core/services/notify.service';
import { parseHttpErrorMessage } from '@shared/utils/http-error.utils';
import { RoleCatalogService } from '@core/services/role-catalog.service';
import { UserService } from '../../../../users/services/user.service';
import type { User } from '../../../../users/models/user.types';
import {
  debouncedUserSearch,
  isSearchableTerm,
  roleToChip,
  searchUsersPage,
  userToChip
} from '../../../utils/user-chip-search';
import type {
  PreviewFlagContext,
  PreviewFlagDraft,
  PreviewFlagRequest
} from '../../../services/feature-flags-admin.service';
import { FeatureFlagsAdminService } from '../../../services/feature-flags-admin.service';

@Component({
  selector: 'nxs-feature-flag-preview',
  imports: [
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIcon,
    MatInput,
    MatProgressSpinner,
    MatCheckbox,
    TranslocoDirective,
    NxsChipsAutocompleteComponent
  ],
  templateUrl: './feature-flag-preview.component.html',
  styleUrl: './feature-flag-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FeatureFlagPreviewComponent implements OnInit, OnDestroy {
  readonly #adminService = inject(FeatureFlagsAdminService);
  readonly #roleCatalog = inject(RoleCatalogService);
  readonly #userService = inject(UserService);
  readonly #notify = inject(NotifyService);
  readonly #transloco = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);

  readonly flagId = input.required<string>();

  /**
   * Unsaved flag state from the surrounding editor. The server evaluates it
   * instead of the persisted flag, so the panel answers for what is on screen.
   */
  readonly draft = input<PreviewFlagDraft | null>(null);

  protected readonly selectedUser = signal<ChipOption[]>([]);
  protected readonly userOptions = signal<ChipOption[]>([]);
  protected readonly env = signal('');
  protected readonly attributesJson = signal('{}');
  protected readonly selectedRoles = signal<ChipOption[]>([]);
  protected readonly roleOptions = signal<ChipOption[]>([]);

  protected readonly useRawJson = signal(false);
  protected readonly rawJson = signal('{}');

  protected readonly loading = signal(false);
  protected readonly result = signal<FeatureFlagPreviewResult | null>(null);
  protected readonly contextError = signal<string | null>(null);

  readonly #userSearch$ = new Subject<string>();

  protected reasonKey(reason: FeatureFlagPreviewResult['reason']): string {
    const map: Record<FeatureFlagPreviewResult['reason'], string> = {
      disabled: 'admin.featureFlagPreview.reason.disabled',
      'env-mismatch': 'admin.featureFlagPreview.reason.envMismatch',
      excluded: 'admin.featureFlagPreview.reason.excluded',
      'included-by-rule': 'admin.featureFlagPreview.reason.includedByRule',
      'no-rules-default-on': 'admin.featureFlagPreview.reason.noRulesDefaultOn'
    };
    return map[reason];
  }

  ngOnInit(): void {
    this.#roleCatalog
      .getAll()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (roles) => {
          this.roleOptions.set(roles.map(roleToChip));
        },
        error: () => {
          // Roles are optional for preview — silently degrade to free-text input.
        }
      });

    this.#userSearch$
      .pipe(
        debouncedUserSearch((term) => this.#searchUsers(term)),
        takeUntilDestroyed(this.#destroyRef)
      )
      .subscribe((users) => {
        this.userOptions.set(users.map(userToChip));
      });
  }

  ngOnDestroy(): void {
    this.#userSearch$.complete();
  }

  // Preview accepts ONE synthetic user — newest chip wins; older ones are
  // dropped to keep the picker a single-selection control without changing
  // the shared NxsChipsAutocompleteComponent API.
  onUserChipsChange(chips: ChipOption[]): void {
    if (chips.length <= 1) {
      this.selectedUser.set(chips);
      return;
    }
    this.selectedUser.set([chips[chips.length - 1]]);
  }

  onUserSearchTerm(term: string): void {
    this.#userSearch$.next(term);
  }

  #searchUsers(term: string) {
    const trimmed = term.trim();
    if (!isSearchableTerm(trimmed)) return of([] as User[]);
    return searchUsersPage(this.#userService, trimmed);
  }

  onRolesChange(next: ChipOption[]): void {
    this.selectedRoles.set(next);
  }

  toggleRawJson(checked: boolean): void {
    if (checked) {
      // Project current structured form into raw JSON.
      const ctx = this.#buildStructuredContext();
      this.rawJson.set(JSON.stringify(ctx, null, 2));
    }
    this.useRawJson.set(checked);
    this.contextError.set(null);
  }

  run(): void {
    const ctx = this.useRawJson()
      ? this.#parseRawJson()
      : this.#buildStructuredContext();
    if (ctx === null) return;
    const request: PreviewFlagRequest = { ...ctx, ...(this.draft() ?? {}) };
    this.loading.set(true);
    this.contextError.set(null);
    this.#adminService
      .preview(this.flagId(), request)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (res) => {
          this.result.set(res);
          this.loading.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          this.#notify.error('admin.featureFlagPreview.errorPreviewFailed', {
            detail: parseHttpErrorMessage(err, this.#transloco)
          });
        }
      });
  }

  #buildStructuredContext(): PreviewFlagContext | null {
    const ctx: PreviewFlagContext = {};
    const user = this.selectedUser()[0];
    if (user) ctx.userId = user.value;
    const roles = this.selectedRoles().map((c) => c.value);
    if (roles.length > 0) ctx.roles = roles;
    const trimmedEnv = this.env().trim();
    if (trimmedEnv.length > 0) ctx.env = trimmedEnv;
    const attrs = this.#parseAttributes();
    if (attrs === null) return null;
    if (Object.keys(attrs).length > 0) ctx.attributes = attrs;
    return ctx;
  }

  #parseAttributes(): Record<string, unknown> | null {
    const text = this.attributesJson().trim();
    if (text === '' || text === '{}') return {};
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        this.contextError.set(
          this.#transloco.translate(
            'admin.featureFlagPreview.advancedJsonInvalid'
          )
        );
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      this.contextError.set(
        this.#transloco.translate(
          'admin.featureFlagPreview.advancedJsonInvalid'
        )
      );
      return null;
    }
  }

  #parseRawJson(): PreviewFlagContext | null {
    const text = this.rawJson().trim();
    if (text === '') return {};
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        this.contextError.set(
          this.#transloco.translate(
            'admin.featureFlagPreview.advancedJsonInvalid'
          )
        );
        return null;
      }
      return parsed as PreviewFlagContext;
    } catch {
      this.contextError.set(
        this.#transloco.translate(
          'admin.featureFlagPreview.advancedJsonInvalid'
        )
      );
      return null;
    }
  }
}
