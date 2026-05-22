import type { OnDestroy, OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild
} from '@angular/core';
import {
  form,
  maxLength,
  minLength,
  pattern,
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
import { TranslocoDirective } from '@jsverse/transloco';
import type {
  CreateFeatureFlag,
  FeatureFlagRuleInput
} from '../../../services/feature-flags-admin.service';
import type { FeatureFlagResponse } from '@app/shared/types';
import { KeyboardShortcutsService } from '@core/services/keyboard-shortcuts.service';
import { AppFormFieldComponent } from '@shared/forms/nxs-form-field/nxs-form-field.component';
import type { ChipOption } from '@shared/forms';
import { ChipsAutocompleteComponent } from '@shared/forms';
import type { FeatureFlagRuleDraft } from '../feature-flag-rule-row/feature-flag-rule-row.component';
import { FeatureFlagRuleRowComponent } from '../feature-flag-rule-row/feature-flag-rule-row.component';
import { FeatureFlagPreviewComponent } from '../feature-flag-preview/feature-flag-preview.component';

export type FeatureFlagFormDialogData = {
  flag?: FeatureFlagResponse;
  /**
   * Environment names already used by other flags in the list. The dialog merges
   * these with a baseline (`development`, `staging`, `production`) to feed the
   * Environments chip-autocomplete suggestions; free-text Enter still works.
   */
  knownEnvironments?: string[];
};

export type FeatureFlagFormDialogResult = {
  flag: CreateFeatureFlag;
  rules: FeatureFlagRuleInput[];
  rulesChanged: boolean;
};

type FlagFormData = {
  key: string;
  description: string;
};

const KEY_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const BASELINE_ENVIRONMENTS = ['development', 'staging', 'production'];

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
    TranslocoDirective,
    AppFormFieldComponent,
    ChipsAutocompleteComponent,
    FeatureFlagRuleRowComponent,
    FeatureFlagPreviewComponent
  ],
  templateUrl: './feature-flag-form-dialog.component.html',
  styleUrl: './feature-flag-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FeatureFlagFormDialogComponent implements OnInit, OnDestroy {
  readonly #dialogRef = inject(
    MatDialogRef<FeatureFlagFormDialogComponent, FeatureFlagFormDialogResult>
  );
  readonly #shortcuts = inject(KeyboardShortcutsService);
  protected readonly data = inject<FeatureFlagFormDialogData>(MAT_DIALOG_DATA);

  #cleanupSave: (() => void) | null = null;

  protected readonly isEdit = !!this.data.flag;

  readonly model = signal<FlagFormData>({
    key: this.data.flag?.key ?? '',
    description: this.data.flag?.description ?? ''
  });

  readonly enabled = signal(this.data.flag?.enabled ?? false);
  readonly isPublic = signal(this.data.flag?.public ?? false);

  readonly environments = signal<ChipOption[]>(
    (this.data.flag?.environments ?? []).map(envToChip)
  );

  protected readonly environmentOptions = computed<ChipOption[]>(() => {
    const merged = new Set<string>([
      ...BASELINE_ENVIRONMENTS,
      ...(this.data.knownEnvironments ?? [])
    ]);
    return Array.from(merged).sort().map(envToChip);
  });

  readonly rules = signal<FeatureFlagRuleDraft[]>(
    (this.data.flag?.rules ?? []).map((r) => ({
      id: r.id,
      effect: r.effect,
      type: r.payload.type,
      payload: r.payload
    }))
  );

  readonly flagForm = form(this.model, (path) => {
    required(path.key);
    minLength(path.key, 2);
    maxLength(path.key, 100);
    pattern(path.key, KEY_PATTERN);
    maxLength(path.description, 500);
  });

  ngOnInit(): void {
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
    if (this.flagForm().invalid()) return;
    const formData = this.model();
    const result: FeatureFlagFormDialogResult = {
      flag: {
        key: formData.key.trim(),
        description: formData.description.trim() || null,
        enabled: this.enabled(),
        environments: this.environments().map((c) => c.value),
        public: this.isPublic()
      },
      rules: this.rules().map((r) => ({
        effect: r.effect,
        type: r.type,
        payload: r.payload
      })),
      rulesChanged: this.#rulesChanged()
    };
    this.#dialogRef.close(result);
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
    return JSON.stringify(original) !== JSON.stringify(current);
  }
}
