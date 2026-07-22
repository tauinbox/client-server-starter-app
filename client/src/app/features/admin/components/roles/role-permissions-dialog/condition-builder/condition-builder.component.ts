import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { TranslocoDirective } from '@jsverse/transloco';
import type {
  ConditionGroup,
  ConditionNode,
  ConditionOperator,
  ConditionRule
} from './condition-builder.types';
import {
  CONDITION_OPERATORS,
  createGroup,
  createRule,
  jsonToModel,
  modelToJson,
  updateGroup,
  updateRule
} from './condition-builder.types';

@Component({
  selector: 'nxs-condition-builder',
  imports: [
    NgTemplateOutlet,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatTooltipModule,
    MatButtonToggleModule,
    TranslocoDirective
  ],
  templateUrl: './condition-builder.component.html',
  styleUrl: './condition-builder.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConditionBuilderComponent implements OnInit {
  readonly value = input<string>('');
  readonly readonly = input<boolean>(false);
  readonly valueChange = output<string>();

  readonly operators = CONDITION_OPERATORS;
  readonly mode = signal<'visual' | 'raw'>('visual');
  readonly rawText = signal('');
  readonly rootGroup = signal<ConditionGroup>(createGroup('$and', []));
  readonly parseError = signal(false);

  readonly previewJson = computed(() => {
    const group = this.rootGroup();
    const json = modelToJson(group);
    return JSON.stringify(json, null, 2);
  });

  // Seeded once from the input: from here on the model is the source of truth
  // and the parent is fed through valueChange, so later echoes of our own value
  // must not reset the tree mid-edit.
  ngOnInit(): void {
    this.#loadFromInput();
  }

  // ─── Mode toggle ──────────────────────────────────────────────────────

  setMode(mode: 'visual' | 'raw'): void {
    if (mode === this.mode()) return;

    if (mode === 'raw') {
      // Sync raw text from current model
      this.rawText.set(this.previewJson());
      this.mode.set('raw');
    } else {
      // Try to parse raw text back into model
      const text = this.rawText().trim();
      if (!text || text === '{}') {
        this.rootGroup.set(createGroup('$and', []));
        this.parseError.set(false);
        this.mode.set('visual');
        return;
      }
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const group = jsonToModel(parsed);
        if (group) {
          this.rootGroup.set(group);
          this.parseError.set(false);
          this.mode.set('visual');
        } else {
          this.parseError.set(true);
        }
      } catch {
        this.parseError.set(true);
      }
    }
  }

  // ─── Raw mode ─────────────────────────────────────────────────────────

  onRawInput(event: Event): void {
    const text = (event.target as HTMLTextAreaElement).value;
    this.rawText.set(text);
    this.parseError.set(false);
  }

  applyRaw(): void {
    const text = this.rawText().trim();
    if (!text) {
      this.#emitValue('');
      return;
    }
    try {
      JSON.parse(text);
      this.#emitValue(text);
    } catch {
      // Keep the text but don't emit — parent will see validation error
    }
  }

  // ─── Group operations ─────────────────────────────────────────────────

  setGroupLogic(group: ConditionGroup, logic: '$and' | '$or'): void {
    this.#patchGroup(group, (target) => ({ ...target, logic }));
  }

  addRule(group: ConditionGroup): void {
    this.#patchGroup(group, (target) => ({
      ...target,
      children: [...target.children, { type: 'rule', rule: createRule() }]
    }));
  }

  addGroup(parent: ConditionGroup): void {
    const child = createGroup('$and', [{ type: 'rule', rule: createRule() }]);
    this.#patchGroup(parent, (target) => ({
      ...target,
      children: [...target.children, { type: 'group', group: child }]
    }));
  }

  removeChild(parent: ConditionGroup, index: number): void {
    this.#patchGroup(parent, (target) => ({
      ...target,
      children: target.children.filter((_, i) => i !== index)
    }));
  }

  // ─── Rule operations ──────────────────────────────────────────────────

  setField(node: ConditionNode, value: string): void {
    this.#patchRule(node, { field: value });
  }

  setOperator(node: ConditionNode, op: ConditionOperator): void {
    this.#patchRule(node, { operator: op });
  }

  setValue(node: ConditionNode, value: string): void {
    this.#patchRule(node, { value });
  }

  getValuePlaceholder(
    operator: ConditionOperator,
    t: (key: string) => string
  ): string {
    switch (operator) {
      case '$in':
      case '$nin':
        return t('admin.conditionBuilder.valuePlaceholderList');
      default:
        return '';
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────

  #loadFromInput(): void {
    const text = this.value().trim();
    this.rawText.set(text || '{\n  \n}');

    if (!text || text === '{}') {
      this.rootGroup.set(createGroup('$and', []));
      return;
    }

    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const group = jsonToModel(parsed);
      if (group) {
        this.rootGroup.set(group);
      } else {
        // Cannot parse into visual model — start in raw mode
        this.mode.set('raw');
        this.rawText.set(text);
      }
    } catch {
      this.mode.set('raw');
      this.rawText.set(text);
    }
  }

  #patchGroup(
    target: ConditionGroup,
    update: (group: ConditionGroup) => ConditionGroup
  ): void {
    this.rootGroup.update((root) => updateGroup(root, target, update));
    this.#emitFromModel();
  }

  #patchRule(
    node: ConditionNode,
    patch: Partial<Omit<ConditionRule, 'id'>>
  ): void {
    if (node.type !== 'rule') return;
    const target = node.rule;
    this.rootGroup.update((root) => updateRule(root, target, patch));
    this.#emitFromModel();
  }

  #emitFromModel(): void {
    const json = modelToJson(this.rootGroup());
    const text =
      Object.keys(json).length > 0 ? JSON.stringify(json, null, 2) : '';
    this.#emitValue(text);
  }

  #emitValue(text: string): void {
    this.valueChange.emit(text);
  }
}
