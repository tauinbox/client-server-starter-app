import type { OnDestroy, OnInit } from '@angular/core';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild
} from '@angular/core';
import {
  form,
  maxLength,
  minLength,
  pattern,
  readonly,
  required
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import {
  MatDialogModule,
  MatDialogRef,
  MAT_DIALOG_DATA
} from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { HttpErrorResponse } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { parseHttpErrorMessage } from '@shared/utils/http-error.utils';
import { FeatureFlagsAdminService } from '../../../services/feature-flags-admin.service';
import { FeatureFlagsAdminStore } from '../../../store/feature-flags-admin.store';
import type {
  PreviewFlagDraft,
  UpdateFeatureFlag
} from '../../../services/feature-flags-admin.service';
import type { FeatureFlagResponse } from '@app/shared/types';
import {
  APP_ENVIRONMENTS,
  FEATURE_FLAG_KEY_MAX_LENGTH,
  FEATURE_FLAG_KEY_MIN_LENGTH,
  FEATURE_FLAG_KEY_PATTERN
} from '@app/shared/constants';
import { KeyboardShortcutsService } from '@core/services/keyboard-shortcuts.service';
import { RoleCatalogService } from '@core/services/role-catalog.service';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { NxsFormFieldComponent } from '@shared/forms/nxs-form-field/nxs-form-field.component';
import { deepEqual } from '@shared/utils/deep-equal.utils';
import { featureFlagRuleError } from '../../../utils/feature-flag-rule-validation';
import { roleToChip } from '../../../utils/user-chip-search';
import {
  confirmEnableForEveryone,
  hasIncludeRule
} from '../../../utils/feature-flag-enable-confirm';
import {
  NxsChipsAutocompleteComponent,
  type ChipOption
} from '@shared/forms/nxs-chips-autocomplete/nxs-chips-autocomplete.component';
import type { FeatureFlagRuleDraft } from '../feature-flag-rule-row/feature-flag-rule-row.component';
import { FeatureFlagRuleRowComponent } from '../feature-flag-rule-row/feature-flag-rule-row.component';
import { FeatureFlagPreviewComponent } from '../feature-flag-preview/feature-flag-preview.component';

export type FeatureFlagFormDialogData = {
  flag?: FeatureFlagResponse;
};

type FlagFormData = {
  key: string;
  description: string;
};

function envToChip(name: string): ChipOption {
  return { value: name, label: name };
}

@Component({
  selector: 'nxs-feature-flag-form-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatCheckbox,
    MatExpansionModule,
    MatIcon,
    MatProgressSpinner,
    TranslocoDirective,
    NxsFormFieldComponent,
    NxsChipsAutocompleteComponent,
    FeatureFlagRuleRowComponent,
    FeatureFlagPreviewComponent
  ],
  templateUrl: './feature-flag-form-dialog.component.html',
  styleUrl: './feature-flag-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FeatureFlagFormDialogComponent implements OnInit, OnDestroy {
  readonly #dialogRef = inject(
    MatDialogRef<FeatureFlagFormDialogComponent, FeatureFlagResponse>
  );
  readonly #store = inject(FeatureFlagsAdminStore);
  readonly #shortcuts = inject(KeyboardShortcutsService);
  readonly #adaptiveDialog = inject(AdaptiveDialogService);
  readonly #transloco = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #flagsAdmin = inject(FeatureFlagsAdminService);
  readonly #roleCatalog = inject(RoleCatalogService);
  protected readonly data = inject<FeatureFlagFormDialogData>(MAT_DIALOG_DATA);

  #cleanupSave: (() => void) | null = null;

  protected readonly isEdit = !!this.data.flag;
  protected readonly isLoading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  private readonly formErrorEl = viewChild('formError', { read: ElementRef });

  constructor() {
    // The error line sits below the rules and the preview, out of view of a
    // long form, so it is brought on screen when it appears.
    afterRenderEffect(() => {
      const el = this.formErrorEl()?.nativeElement as HTMLElement | undefined;
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  readonly model = signal<FlagFormData>({
    key: this.data.flag?.key ?? '',
    description: this.data.flag?.description ?? ''
  });

  readonly enabled = signal(this.data.flag?.enabled ?? false);
  readonly isPublic = signal(this.data.flag?.public ?? false);

  readonly environments = signal<ChipOption[]>(
    (this.data.flag?.environments ?? []).map(envToChip)
  );

  // Free text is deliberately off: the API rejects anything the server cannot
  // run as, so an invented name would only surface as a save-time 400.
  protected readonly environmentOptions: ChipOption[] =
    APP_ENVIRONMENTS.map(envToChip);

  readonly rules = signal<FeatureFlagRuleDraft[]>(
    (this.data.flag?.rules ?? []).map((r) => ({
      id: r.id,
      effect: r.effect,
      type: r.payload.type,
      payload: r.payload
    }))
  );

  // The registered custom attribute keys, or null while the request is in
  // flight or after it failed. Null keeps the membership check off, so a
  // catalog the admin cannot see never blocks a save the server would accept.
  readonly #customKeys = signal<ReadonlySet<string> | null>(null);

  protected readonly customKeyOptions = computed<string[]>(() => [
    ...(this.#customKeys() ?? [])
  ]);

  // Loaded once for every rule row and the preview. Empty while the request
  // is in flight, or after it failed.
  protected readonly roleOptions = signal<ChipOption[]>([]);

  // A rules rejection fails the whole save, so the incomplete drafts the
  // editor can produce are blocked before the request.
  readonly ruleErrors = computed<(string | null)[]>(() =>
    this.rules().map((r) => featureFlagRuleError(r.payload, this.#customKeys()))
  );

  readonly hasRuleErrors = computed(() =>
    this.ruleErrors().some((e) => e !== null)
  );

  // The preview panel evaluates this instead of the persisted flag, so it
  // answers for the rules and toggles currently on screen.
  readonly previewDraft = computed<PreviewFlagDraft>(() => ({
    rules: this.rules().map((r) => ({
      effect: r.effect,
      type: r.type,
      payload: r.payload
    })),
    enabled: this.enabled(),
    environments: this.environments().map((c) => c.value)
  }));

  readonly flagForm = form(this.model, (path) => {
    required(path.key);
    minLength(path.key, FEATURE_FLAG_KEY_MIN_LENGTH);
    maxLength(path.key, FEATURE_FLAG_KEY_MAX_LENGTH);
    pattern(path.key, FEATURE_FLAG_KEY_PATTERN);
    readonly(path.key, () => this.isEdit);
    maxLength(path.description, 500);
  });

  ngOnInit(): void {
    this.#flagsAdmin
      .getAttributeKeys()
      .pipe(
        catchError(() => of(null)),
        takeUntilDestroyed(this.#destroyRef)
      )
      .subscribe((response) => {
        if (response === null) return;
        this.#customKeys.set(new Set(response.customKeys));
      });

    this.#roleCatalog
      .getAll()
      .pipe(
        catchError(() => of([])),
        takeUntilDestroyed(this.#destroyRef)
      )
      .subscribe((roles) => this.roleOptions.set(roles.map(roleToChip)));

    this.#cleanupSave = this.#shortcuts.registerSave(
      'shortcuts.labelSave',
      'shortcuts.groupForms',
      () => this.submit()
    );
  }

  ngOnDestroy(): void {
    this.#cleanupSave?.();
  }

  onEnabledChange(checked: boolean): void {
    this.enabled.set(checked);
  }

  onPublicChange(checked: boolean): void {
    this.isPublic.set(checked);
  }

  onEnvironmentsChange(next: ChipOption[]): void {
    this.environments.set(next);
  }

  addRule(): void {
    const next = [...this.rules()];
    next.push({
      effect: 'include',
      type: 'percentage',
      payload: { type: 'percentage', percent: 0 }
    });
    this.rules.set(next);
  }

  updateRule(index: number, draft: FeatureFlagRuleDraft): void {
    const next = [...this.rules()];
    next[index] = draft;
    this.rules.set(next);
  }

  removeRule(index: number): void {
    const next = [...this.rules()];
    next.splice(index, 1);
    this.rules.set(next);
  }

  submit(): void {
    if (this.flagForm().invalid() || this.hasRuleErrors() || this.isLoading())
      return;
    if (this.enabled() && !hasIncludeRule(this.rules())) {
      confirmEnableForEveryone(
        this.#adaptiveDialog,
        this.#transloco,
        this.model().key.trim()
      )
        .pipe(takeUntilDestroyed(this.#destroyRef))
        .subscribe((confirmed) => {
          if (confirmed) this.#save();
        });
      return;
    }
    this.#save();
  }

  // `key` goes to create only, because the server rejects a key on update.
  // `rules` is sent only when the rule set changed, so an unchanged set is not
  // rewritten.
  #save(): void {
    const formData = this.model();
    const flag: UpdateFeatureFlag = {
      description: formData.description.trim() || null,
      enabled: this.enabled(),
      environments: this.environments().map((c) => c.value),
      public: this.isPublic(),
      ...(this.#rulesChanged()
        ? {
            rules: this.rules().map((r) => ({
              effect: r.effect,
              type: r.type,
              payload: r.payload
            }))
          }
        : {})
    };
    const existing = this.data.flag;
    const save$ = existing
      ? this.#store.updateFlag(existing.id, flag, existing.version)
      : this.#store.createFlag({ key: formData.key.trim(), ...flag });

    this.isLoading.set(true);
    this.errorMessage.set(null);
    save$.pipe(takeUntilDestroyed(this.#destroyRef)).subscribe({
      next: (saved) => this.#dialogRef.close(saved),
      error: (err: HttpErrorResponse) => {
        this.isLoading.set(false);
        this.errorMessage.set(
          parseHttpErrorMessage(
            err,
            this.#transloco,
            existing
              ? 'admin.featureFlags.errorUpdateFailed'
              : 'admin.featureFlags.errorCreateFailed'
          )
        );
      }
    });
  }

  cancel(): void {
    this.#dialogRef.close();
  }

  readonly previewPanelEl = viewChild('previewPanel', { read: ElementRef });

  onPreviewExpanded(): void {
    // Inside mat-dialog-content the form scrolls separately from the page —
    // expanding the panel adds ~400px of content below the visible fold, so
    // we explicitly reveal the bottom of the panel where the Run button lives.
    const el = this.previewPanelEl()?.nativeElement as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  #rulesChanged(): boolean {
    if (!this.data.flag) return this.rules().length > 0;
    const original = this.data.flag.rules.map((r) => ({
      effect: r.effect,
      payload: r.payload
    }));
    const current = this.rules().map((r) => ({
      effect: r.effect,
      payload: r.payload
    }));
    return !deepEqual(original, current);
  }
}
