import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatCheckbox } from '@angular/material/checkbox';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { FeatureFlagPreviewResult } from '@app/shared/types';
import { ChipsAutocompleteComponent, type ChipOption } from '@shared/forms';
import { NotifyService } from '@core/services/notify.service';
import { RoleService } from '../../../services/role.service';
import type { PreviewFlagContext } from '../../../services/feature-flags-admin.service';
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
    ChipsAutocompleteComponent
  ],
  templateUrl: './feature-flag-preview.component.html',
  styleUrl: './feature-flag-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FeatureFlagPreviewComponent implements OnInit {
  readonly #adminService = inject(FeatureFlagsAdminService);
  readonly #roleService = inject(RoleService);
  readonly #notify = inject(NotifyService);
  readonly #transloco = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);

  readonly flagId = input.required<string>();

  protected readonly userId = signal('');
  protected readonly env = signal('');
  protected readonly attributesJson = signal('{}');
  protected readonly selectedRoles = signal<ChipOption[]>([]);
  protected readonly roleOptions = signal<ChipOption[]>([]);

  protected readonly useRawJson = signal(false);
  protected readonly rawJson = signal('{}');

  protected readonly loading = signal(false);
  protected readonly result = signal<FeatureFlagPreviewResult | null>(null);
  protected readonly contextError = signal<string | null>(null);

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
    this.#roleService
      .getAll()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (roles) => {
          this.roleOptions.set(
            roles.map((r) => ({
              value: r.name,
              label: r.name,
              sub: r.description ?? undefined
            }))
          );
        },
        error: () => {
          // Roles are optional for preview — silently degrade to free-text input.
        }
      });
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
    this.loading.set(true);
    this.contextError.set(null);
    this.#adminService
      .preview(this.flagId(), ctx)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (res) => {
          this.result.set(res);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.#notify.error('admin.featureFlagPreview.errorPreviewFailed');
        }
      });
  }

  #buildStructuredContext(): PreviewFlagContext | null {
    const ctx: PreviewFlagContext = {};
    const trimmedUser = this.userId().trim();
    if (trimmedUser.length > 0) ctx.userId = trimmedUser;
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
