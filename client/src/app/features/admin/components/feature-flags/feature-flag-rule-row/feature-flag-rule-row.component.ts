import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  model,
  output
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatOption } from '@angular/material/core';
import { MatSelect } from '@angular/material/select';
import { MatSlider, MatSliderThumb } from '@angular/material/slider';
import { TranslocoDirective } from '@jsverse/transloco';
import type {
  FeatureFlagAttributeField,
  FeatureFlagAttributeOp,
  FeatureFlagRuleEffect,
  FeatureFlagRulePayload,
  FeatureFlagRuleType
} from '@app/shared/types';
import { LayoutService } from '@core/services/layout.service';

export type FeatureFlagRuleDraft = {
  id?: string;
  type: FeatureFlagRuleType;
  effect: FeatureFlagRuleEffect;
  payload: FeatureFlagRulePayload;
};

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

@Component({
  selector: 'nxs-feature-flag-rule-row',
  imports: [
    MatIconButton,
    MatFormField,
    MatLabel,
    MatIcon,
    MatInput,
    MatOption,
    MatSelect,
    MatSlider,
    MatSliderThumb,
    TranslocoDirective
  ],
  templateUrl: './feature-flag-rule-row.component.html',
  styleUrl: './feature-flag-rule-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FeatureFlagRuleRowComponent {
  readonly rule = model.required<FeatureFlagRuleDraft>();
  readonly remove = output<void>();

  protected readonly layout = inject(LayoutService);

  protected readonly types = RULE_TYPES;
  protected readonly effects = RULE_EFFECTS;
  protected readonly attributeFields = ATTRIBUTE_FIELDS;
  protected readonly attributeOps = ATTRIBUTE_OPS;

  protected readonly typeLabel = computed(() => this.rule().type);

  protected get userIdsValue(): string {
    const p = this.rule().payload;
    return p.type === 'user' ? p.userIds.join(', ') : '';
  }

  protected get roleNamesValue(): string {
    const p = this.rule().payload;
    return p.type === 'role' ? p.roleNames.join(', ') : '';
  }

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

  protected get attributeValue(): string {
    const p = this.rule().payload;
    if (p.type !== 'attribute') return '';
    const v = p.value;
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'string') return v;
    if (v === undefined || v === null) return '';
    return String(v);
  }

  protected get attributeCustomKey(): string {
    const p = this.rule().payload;
    return p.type === 'attribute' ? (p.customKey ?? '') : '';
  }

  onTypeChange(type: FeatureFlagRuleType): void {
    const next: FeatureFlagRulePayload = this.#defaultPayloadFor(type);
    this.rule.set({ ...this.rule(), type, payload: next });
  }

  onEffectChange(effect: FeatureFlagRuleEffect): void {
    this.rule.set({ ...this.rule(), effect });
  }

  onUserIdsChange(value: string): void {
    this.#updatePayload({
      type: 'user',
      userIds: this.#splitCsv(value)
    });
  }

  onRoleNamesChange(value: string): void {
    this.#updatePayload({
      type: 'role',
      roleNames: this.#splitCsv(value)
    });
  }

  onPercentChange(value: number | string): void {
    const num =
      typeof value === 'number'
        ? value
        : Number.isFinite(Number(value))
          ? Number(value)
          : 0;
    const clamped = Math.max(0, Math.min(100, Math.round(num)));
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
    this.#updatePayload({
      type: 'attribute',
      field: current.field,
      op,
      value: op === 'in' ? this.#splitCsv(this.attributeValue) : current.value,
      ...(current.customKey !== undefined
        ? { customKey: current.customKey }
        : {})
    });
  }

  onAttributeValueChange(raw: string): void {
    const current = this.rule().payload;
    if (current.type !== 'attribute') return;
    const parsed: unknown = current.op === 'in' ? this.#splitCsv(raw) : raw;
    this.#updatePayload({
      type: 'attribute',
      field: current.field,
      op: current.op,
      value: parsed,
      ...(current.customKey !== undefined
        ? { customKey: current.customKey }
        : {})
    });
  }

  onAttributeCustomKeyChange(customKey: string): void {
    const current = this.rule().payload;
    if (current.type !== 'attribute') return;
    this.#updatePayload({
      type: 'attribute',
      field: current.field,
      op: current.op,
      value: current.value,
      customKey
    });
  }

  emitRemove(): void {
    this.remove.emit();
  }

  #splitCsv(value: string): string[] {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  #updatePayload(payload: FeatureFlagRulePayload): void {
    this.rule.set({ ...this.rule(), payload });
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
