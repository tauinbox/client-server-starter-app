import type { OnDestroy, OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  model,
  output,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconButton } from '@angular/material/button';
import {
  MatDatepicker,
  MatDatepickerInput,
  MatDatepickerToggle
} from '@angular/material/datepicker';
import {
  MatFormField,
  MatLabel,
  MatSuffix
} from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatOption } from '@angular/material/core';
import { MatSelect } from '@angular/material/select';
import { MatSlider, MatSliderThumb } from '@angular/material/slider';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslocoDirective } from '@jsverse/transloco';
import { forkJoin, of, Subject } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import type {
  FeatureFlagAttributeField,
  FeatureFlagAttributeOp,
  FeatureFlagRuleEffect,
  FeatureFlagRulePayload,
  FeatureFlagRuleType
} from '@app/shared/types';
import { LayoutService } from '@core/services/layout.service';
import type { ChipOption } from '@shared/forms';
import { ChipsAutocompleteComponent } from '@shared/forms';
import { RoleService } from '../../../services/role.service';
import { UserService } from '../../../../users/services/user.service';
import type { User } from '../../../../users/models/user.types';
import {
  debouncedUserSearch,
  roleToChip,
  searchUsersPage,
  USER_SEARCH_LIMIT,
  USER_SEARCH_MIN_CHARS,
  userToChip
} from '../../../utils/user-chip-search';

export type FeatureFlagRuleDraft = {
  id?: string;
  type: FeatureFlagRuleType;
  effect: FeatureFlagRuleEffect;
  payload: FeatureFlagRulePayload;
};

type AttributePayload = Extract<FeatureFlagRulePayload, { type: 'attribute' }>;

const RULE_TYPES: FeatureFlagRuleType[] = [
  'user',
  'role',
  'percentage',
  'attribute'
];
const RULE_EFFECTS: FeatureFlagRuleEffect[] = ['include', 'exclude'];
const ATTRIBUTE_FIELDS: FeatureFlagAttributeField[] = [
  'email',
  'emailDomain',
  'createdAt',
  'custom'
];
const ATTRIBUTE_OPS: FeatureFlagAttributeOp[] = [
  'eq',
  'in',
  'endsWith',
  'before',
  'after'
];

const PERCENT_STEP = 5;

function userMatchesTerm(user: User, lowered: string): boolean {
  return (
    user.email.toLowerCase().includes(lowered) ||
    user.firstName.toLowerCase().includes(lowered) ||
    user.lastName.toLowerCase().includes(lowered) ||
    user.id.toLowerCase().includes(lowered)
  );
}

@Component({
  selector: 'nxs-feature-flag-rule-row',
  imports: [
    MatIconButton,
    MatDatepicker,
    MatDatepickerInput,
    MatDatepickerToggle,
    MatFormField,
    MatLabel,
    MatSuffix,
    MatIcon,
    MatInput,
    MatOption,
    MatSelect,
    MatSlider,
    MatSliderThumb,
    MatTooltip,
    ChipsAutocompleteComponent,
    TranslocoDirective
  ],
  templateUrl: './feature-flag-rule-row.component.html',
  styleUrl: './feature-flag-rule-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FeatureFlagRuleRowComponent implements OnInit, OnDestroy {
  readonly rule = model.required<FeatureFlagRuleDraft>();
  readonly remove = output<void>();

  protected readonly layout = inject(LayoutService);
  readonly #roleService = inject(RoleService);
  readonly #userService = inject(UserService);
  readonly #destroyRef = inject(DestroyRef);

  protected readonly types = RULE_TYPES;
  protected readonly effects = RULE_EFFECTS;
  protected readonly attributeFields = ATTRIBUTE_FIELDS;
  protected readonly attributeOps = ATTRIBUTE_OPS;

  // Chip-label caches — keyed by the underlying API value (user UUID or role
  // name) so subsequent edits keep the human-readable display even if the
  // autocomplete list has churned to a different page of results.
  readonly #userLabelCache = signal(new Map<string, ChipOption>());
  readonly #roleLabelCache = signal(new Map<string, ChipOption>());

  protected readonly userOptions = signal<ChipOption[]>([]);
  protected readonly roleOptions = signal<ChipOption[]>([]);

  protected readonly userChips = computed<ChipOption[]>(() => {
    const payload = this.rule().payload;
    if (payload.type !== 'user') return [];
    const cache = this.#userLabelCache();
    return payload.userIds.map(
      (id) => cache.get(id) ?? { value: id, label: id }
    );
  });

  protected readonly roleChips = computed<ChipOption[]>(() => {
    const payload = this.rule().payload;
    if (payload.type !== 'role') return [];
    const cache = this.#roleLabelCache();
    return payload.roleNames.map(
      (name) => cache.get(name) ?? { value: name, label: name }
    );
  });

  protected readonly attrValueChips = computed<ChipOption[]>(() => {
    const payload = this.rule().payload;
    if (payload.type !== 'attribute' || payload.op !== 'in') return [];
    const v = payload.value;
    const arr = Array.isArray(v) ? v : [];
    return arr
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
      .map((s) => ({ value: s, label: s }));
  });

  readonly #userSearch$ = new Subject<string>();

  protected get percentValue(): number {
    const p = this.rule().payload;
    return p.type === 'percentage' ? p.percent : 0;
  }

  protected get attributeField(): FeatureFlagAttributeField {
    const p = this.rule().payload;
    return p.type === 'attribute' ? p.field : 'email';
  }

  protected get attributeOp(): FeatureFlagAttributeOp {
    const p = this.rule().payload;
    return p.type === 'attribute' ? p.op : 'eq';
  }

  protected get attributeValueText(): string {
    const p = this.rule().payload;
    if (p.type !== 'attribute') return '';
    const v = p.value;
    if (Array.isArray(v)) return '';
    if (typeof v === 'string') return v;
    if (v === undefined || v === null) return '';
    return String(v);
  }

  protected get attributeCustomKey(): string {
    const p = this.rule().payload;
    return p.type === 'attribute' ? (p.customKey ?? '') : '';
  }

  protected get attributeDateValue(): Date | null {
    const p = this.rule().payload;
    if (p.type !== 'attribute') return null;
    if (p.op !== 'before' && p.op !== 'after') return null;
    if (typeof p.value !== 'string' || p.value.length === 0) return null;
    const d = new Date(p.value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  protected readonly isDateOp = computed(() => {
    const p = this.rule().payload;
    return p.type === 'attribute' && (p.op === 'before' || p.op === 'after');
  });

  ngOnInit(): void {
    this.#preloadUserLabelsFromExistingRule();

    this.#userSearch$
      .pipe(
        debouncedUserSearch((term) => this.#searchUsers(term)),
        takeUntilDestroyed(this.#destroyRef)
      )
      .subscribe((users) => {
        const next = new Map(this.#userLabelCache());
        const chips: ChipOption[] = [];
        for (const u of users) {
          const chip = userToChip(u);
          next.set(chip.value, chip);
          chips.push(chip);
        }
        this.#userLabelCache.set(next);
        this.userOptions.set(chips);
      });

    this.#roleService
      .getAll()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((roles) => {
        const cache = new Map(this.#roleLabelCache());
        const opts: ChipOption[] = [];
        for (const r of roles) {
          const chip = roleToChip(r);
          cache.set(chip.value, chip);
          opts.push(chip);
        }
        this.#roleLabelCache.set(cache);
        this.roleOptions.set(opts);
      });
  }

  ngOnDestroy(): void {
    this.#userSearch$.complete();
  }

  #preloadUserLabelsFromExistingRule(): void {
    const payload = this.rule().payload;
    if (payload.type !== 'user' || payload.userIds.length === 0) return;
    const cache = this.#userLabelCache();
    const missing = payload.userIds.filter((id) => !cache.has(id));
    if (missing.length === 0) return;
    forkJoin(
      missing.map((id) =>
        this.#userService.getById(id).pipe(catchError(() => of(null)))
      )
    )
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((users) => {
        const next = new Map(this.#userLabelCache());
        for (const u of users) {
          if (u === null) continue;
          const chip = userToChip(u);
          next.set(chip.value, chip);
        }
        this.#userLabelCache.set(next);
      });
  }

  // Last completed server response — used to skip the network when the new
  // term is a (case-insensitive) extension of the previous one AND the
  // previous response was the full result set (length < page size). In that
  // case the previous results are a strict superset of the new ones, so
  // local filtering is exact.
  #lastSearch: {
    term: string;
    results: User[];
    isComplete: boolean;
  } | null = null;

  #searchUsers(term: string) {
    const trimmed = term.trim();
    if (trimmed.length < USER_SEARCH_MIN_CHARS) {
      this.#lastSearch = null;
      return of([] as User[]);
    }

    const lowered = trimmed.toLowerCase();
    const prev = this.#lastSearch;
    if (
      prev &&
      prev.isComplete &&
      lowered.startsWith(prev.term.toLowerCase())
    ) {
      const filtered = prev.results.filter((u) => userMatchesTerm(u, lowered));
      // Refresh the cache anchor so successive narrowings keep working
      // without ever hitting the network.
      this.#lastSearch = {
        term: trimmed,
        results: filtered,
        isComplete: true
      };
      return of(filtered);
    }

    return searchUsersPage(this.#userService, trimmed).pipe(
      map((users) => {
        this.#lastSearch = {
          term: trimmed,
          results: users,
          isComplete: users.length < USER_SEARCH_LIMIT
        };
        return users;
      })
    );
  }

  onTypeChange(type: FeatureFlagRuleType): void {
    const next: FeatureFlagRulePayload = this.#defaultPayloadFor(type);
    this.rule.set({ ...this.rule(), type, payload: next });
  }

  onEffectChange(effect: FeatureFlagRuleEffect): void {
    this.rule.set({ ...this.rule(), effect });
  }

  onUserChipsChange(chips: ChipOption[]): void {
    const cache = new Map(this.#userLabelCache());
    for (const c of chips) cache.set(c.value, c);
    this.#userLabelCache.set(cache);
    this.#updatePayload({
      type: 'user',
      userIds: chips.map((c) => c.value)
    });
  }

  onUserSearchTerm(term: string): void {
    this.#userSearch$.next(term);
  }

  onRoleChipsChange(chips: ChipOption[]): void {
    this.#updatePayload({
      type: 'role',
      roleNames: chips.map((c) => c.value)
    });
  }

  onPercentChange(value: number | string): void {
    const num =
      typeof value === 'number'
        ? value
        : Number.isFinite(Number(value))
          ? Number(value)
          : 0;
    const snapped = Math.round(num / PERCENT_STEP) * PERCENT_STEP;
    const clamped = Math.max(0, Math.min(100, snapped));
    this.#updatePayload({ type: 'percentage', percent: clamped });
  }

  onAttributeFieldChange(field: FeatureFlagAttributeField): void {
    const current = this.rule().payload;
    const op = current.type === 'attribute' ? current.op : 'eq';
    const value = current.type === 'attribute' ? current.value : '';
    const customKey =
      field === 'custom'
        ? current.type === 'attribute'
          ? (current.customKey ?? '')
          : ''
        : undefined;
    this.#updatePayload({
      type: 'attribute',
      field,
      op,
      value,
      ...(customKey !== undefined ? { customKey } : {})
    });
  }

  onAttributeOpChange(op: FeatureFlagAttributeOp): void {
    const current = this.rule().payload;
    if (current.type !== 'attribute') return;
    let nextValue: unknown;
    if (op === 'in') {
      // Switching INTO `in`: preserve any existing scalar as the first chip.
      const existing = current.value;
      if (Array.isArray(existing)) nextValue = existing;
      else if (typeof existing === 'string' && existing.trim().length > 0)
        nextValue = [existing.trim()];
      else nextValue = [];
    } else if (current.op === 'in') {
      // Switching OUT of `in`: collapse first chip to a scalar so the new
      // single-input field has a sensible starting value.
      const arr = Array.isArray(current.value) ? current.value : [];
      nextValue = arr.length > 0 ? String(arr[0]) : '';
    } else {
      nextValue = current.value;
    }
    this.#patchAttributePayload({ op, value: nextValue });
  }

  onAttributeValueChange(raw: string): void {
    this.#patchAttributePayload({ value: raw });
  }

  onAttributeDateChange(date: Date | null): void {
    const current = this.rule().payload;
    if (current.type !== 'attribute') return;
    if (current.op !== 'before' && current.op !== 'after') return;
    const value =
      date instanceof Date && !Number.isNaN(date.getTime())
        ? date.toISOString()
        : '';
    this.#patchAttributePayload({ value });
  }

  onAttributeChipsChange(chips: ChipOption[]): void {
    const current = this.rule().payload;
    if (current.type !== 'attribute' || current.op !== 'in') return;
    this.#patchAttributePayload({ value: chips.map((c) => c.value) });
  }

  onAttributeCustomKeyChange(customKey: string): void {
    this.#patchAttributePayload({ customKey });
  }

  emitRemove(): void {
    this.remove.emit();
  }

  #updatePayload(payload: FeatureFlagRulePayload): void {
    this.rule.set({ ...this.rule(), payload });
  }

  // Rebuilds the attribute payload, preserving `field` and `customKey` unless
  // the caller overrides them. `customKey` is kept only when present in the
  // current payload; pass it explicitly to set or (with `undefined`) drop it.
  // No-op when the current payload is not an attribute rule.
  #patchAttributePayload(
    partial: Partial<Pick<AttributePayload, 'op' | 'value' | 'customKey'>>
  ): void {
    const current = this.rule().payload;
    if (current.type !== 'attribute') return;
    const customKey =
      'customKey' in partial ? partial.customKey : current.customKey;
    this.#updatePayload({
      type: 'attribute',
      field: current.field,
      op: partial.op ?? current.op,
      value: 'value' in partial ? partial.value : current.value,
      ...(customKey !== undefined ? { customKey } : {})
    });
  }

  #defaultPayloadFor(type: FeatureFlagRuleType): FeatureFlagRulePayload {
    switch (type) {
      case 'user':
        return { type: 'user', userIds: [] };
      case 'role':
        return { type: 'role', roleNames: [] };
      case 'percentage':
        return { type: 'percentage', percent: 0 };
      case 'attribute':
        return { type: 'attribute', field: 'email', op: 'eq', value: '' };
    }
  }
}
