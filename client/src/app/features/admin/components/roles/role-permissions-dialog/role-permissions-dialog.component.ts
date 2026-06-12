import type { OnInit, WritableSignal } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type {
  PermissionCondition,
  PermissionEffect,
  PermissionResponse,
  RoleAdminResponse
} from '@app/shared/types/role.types';
import { NotifyService } from '@core/services/notify.service';
import type { RolePermissionItem } from '../../../services/role.service';
import { RoleService } from '../../../services/role.service';
import { ConditionBuilderComponent } from './condition-builder/condition-builder.component';

export type RolePermissionsDialogData = {
  role: RoleAdminResponse;
  readonly?: boolean;
};

export type PermissionGroup = {
  resource: string;
  permissions: PermissionResponse[];
};

/**
 * Condition editors backed by a raw JSON text buffer. `custom` is NOT one of
 * them — it keeps invalid text in the condition itself and patches anyway.
 */
type JsonObjectEditor = 'fieldMatch' | 'userAttr';

const JSON_EDITOR_SEEDS: Record<JsonObjectEditor, string> = {
  fieldMatch: '{\n  "fieldName": ["value1", "value2"]\n}',
  userAttr: '{\n  "recordField": "id"\n}'
};

@Component({
  selector: 'nxs-role-permissions-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    MatChipsModule,
    MatTooltipModule,
    MatIconModule,
    TranslocoDirective,
    ConditionBuilderComponent
  ],
  templateUrl: './role-permissions-dialog.component.html',
  styleUrl: './role-permissions-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RolePermissionsDialogComponent implements OnInit {
  readonly #roleService = inject(RoleService);
  readonly #dialogRef = inject(MatDialogRef<RolePermissionsDialogComponent>);
  readonly #notify = inject(NotifyService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #translocoService = inject(TranslocoService);

  protected readonly data = inject<RolePermissionsDialogData>(MAT_DIALOG_DATA);
  protected readonly role = this.data.role;
  protected readonly isReadonly = signal(this.data.readonly ?? false);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly permissionGroups = signal<PermissionGroup[]>([]);

  /** Checked state: permissionId → is assigned */
  readonly selectedIds = signal<Set<string>>(new Set());

  /** Conditions per permission: permissionId → PermissionCondition | null */
  readonly conditionsMap = signal<Map<string, PermissionCondition | null>>(
    new Map()
  );

  /** Expanded condition editors: permissionId → open? */
  readonly expandedIds = signal<Set<string>>(new Set());

  /** Raw JSON text buffers for fieldMatch and userAttr editors */
  readonly fieldMatchText = signal<Map<string, string>>(new Map());
  readonly userAttrText = signal<Map<string, string>>(new Map());

  /**
   * Validation errors for JSON fields.
   * Key: `${permissionId}:fieldMatch` | `${permissionId}:userAttr` | `${permissionId}:custom`
   */
  readonly jsonErrors = signal<Map<string, string>>(new Map());

  // Originals for dirty detection (plain objects, not signals)
  #originalIds = new Set<string>();
  #originalConditions = new Map<string, PermissionCondition | null>();

  readonly checkedPermissions = computed(() => {
    const selected = this.selectedIds();
    return this.permissionGroups()
      .flatMap((g) => g.permissions)
      .filter((p) => selected.has(p.id));
  });

  readonly isDirty = computed(() => {
    const current = this.selectedIds();
    const conditions = this.conditionsMap();

    if (current.size !== this.#originalIds.size) return true;
    for (const id of current) {
      if (!this.#originalIds.has(id)) return true;
    }
    for (const id of current) {
      const orig = JSON.stringify(this.#originalConditions.get(id) ?? null);
      const curr = JSON.stringify(conditions.get(id) ?? null);
      if (orig !== curr) return true;
    }
    return false;
  });

  /** Save is allowed only when there are changes, no JSON errors and not readonly */
  readonly canSave = computed(
    () =>
      !this.saving() &&
      !this.isReadonly() &&
      this.isDirty() &&
      this.jsonErrors().size === 0
  );

  ngOnInit(): void {
    forkJoin({
      allPermissions: this.#roleService.getAllPermissions(),
      rolePermissions: this.#roleService.getRolePermissions(this.role.id)
    })
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: ({ allPermissions, rolePermissions }) => {
          this.permissionGroups.set(this.#groupByResource(allPermissions));
          this.#initState(rolePermissions);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(
            this.#translocoService.translate(
              'admin.rolePermissions.errorLoadFailed'
            )
          );
          this.loading.set(false);
        }
      });
  }

  // ─── Checkbox helpers ────────────────────────────────────────────────

  isChecked(permissionId: string): boolean {
    return this.selectedIds().has(permissionId);
  }

  isGroupAllChecked(group: PermissionGroup): boolean {
    return group.permissions.every((p) => this.selectedIds().has(p.id));
  }

  isGroupIndeterminate(group: PermissionGroup): boolean {
    const n = group.permissions.filter((p) =>
      this.selectedIds().has(p.id)
    ).length;
    return n > 0 && n < group.permissions.length;
  }

  togglePermission(permissionId: string): void {
    if (this.role.isSystem) return;
    const next = new Set(this.selectedIds());
    if (next.has(permissionId)) {
      next.delete(permissionId);
      this.#collapseAndClear(permissionId);
    } else {
      next.add(permissionId);
    }
    this.selectedIds.set(next);
  }

  toggleGroup(group: PermissionGroup): void {
    if (this.role.isSystem) return;
    const next = new Set(this.selectedIds());
    const allChecked = this.isGroupAllChecked(group);
    for (const p of group.permissions) {
      if (allChecked) {
        next.delete(p.id);
        this.#collapseAndClear(p.id);
      } else {
        next.add(p.id);
      }
    }
    this.selectedIds.set(next);
  }

  // ─── Conditions helpers ───────────────────────────────────────────────

  isExpanded(permissionId: string): boolean {
    return this.expandedIds().has(permissionId);
  }

  hasAnyCondition(permissionId: string): boolean {
    return this.activeConditionTypes(permissionId).length > 0;
  }

  activeConditionTypes(permissionId: string): string[] {
    const c = this.conditionsMap().get(permissionId);
    if (!c) return [];
    const types: string[] = [];
    if (c.ownership) types.push('ownership');
    if (c.fieldMatch) types.push('fieldMatch');
    if (c.userAttr) types.push('userAttr');
    if (c.custom) types.push('custom');
    return types;
  }

  // ─── Effect (allow / deny) ────────────────────────────────────────────

  isDeny(permissionId: string): boolean {
    return this.conditionsMap().get(permissionId)?.effect === 'deny';
  }

  setEffect(permissionId: string, effect: PermissionEffect): void {
    if (this.role.isSystem || this.isReadonly()) return;
    const map = new Map(this.conditionsMap());
    const current = map.get(permissionId) ?? {};
    if (effect === 'deny') {
      map.set(permissionId, { ...current, effect: 'deny' });
    } else {
      // 'allow' is the implicit default — strip the field. If nothing else
      // is left, collapse to null so the dirty check treats a pure-allow
      // permission as unconditional.
      const next: PermissionCondition = { ...current };
      delete next.effect;
      map.set(permissionId, Object.keys(next).length > 0 ? next : null);
    }
    this.conditionsMap.set(map);
  }

  toggleExpand(permissionId: string): void {
    const next = new Set(this.expandedIds());
    if (next.has(permissionId)) {
      next.delete(permissionId);
    } else {
      next.add(permissionId);
    }
    this.expandedIds.set(next);
  }

  // ─── Ownership ────────────────────────────────────────────────────────

  hasOwnership(permissionId: string): boolean {
    return !!this.conditionsMap().get(permissionId)?.ownership;
  }

  getOwnershipField(permissionId: string): string {
    return this.conditionsMap().get(permissionId)?.ownership?.userField ?? '';
  }

  toggleOwnership(permissionId: string): void {
    if (this.hasOwnership(permissionId)) {
      this.#removeConditionKey(permissionId, 'ownership');
    } else {
      this.#patchCondition(permissionId, { ownership: { userField: 'id' } });
    }
  }

  setOwnershipField(permissionId: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.#patchCondition(permissionId, { ownership: { userField: value } });
  }

  // ─── fieldMatch / userAttr (JSON object editors) ──────────────────────

  hasFieldMatch(permissionId: string): boolean {
    return this.#hasJsonEditor(permissionId, 'fieldMatch');
  }

  getFieldMatchText(permissionId: string): string {
    return this.#jsonEditorText(permissionId, 'fieldMatch');
  }

  getFieldMatchError(permissionId: string): string {
    return this.#jsonEditorError(permissionId, 'fieldMatch');
  }

  toggleFieldMatch(permissionId: string): void {
    this.#toggleJsonEditor(permissionId, 'fieldMatch');
  }

  applyFieldMatch(permissionId: string, event: Event): void {
    this.#applyJsonEditor(permissionId, 'fieldMatch', event);
  }

  hasUserAttr(permissionId: string): boolean {
    return this.#hasJsonEditor(permissionId, 'userAttr');
  }

  getUserAttrText(permissionId: string): string {
    return this.#jsonEditorText(permissionId, 'userAttr');
  }

  getUserAttrError(permissionId: string): string {
    return this.#jsonEditorError(permissionId, 'userAttr');
  }

  toggleUserAttr(permissionId: string): void {
    this.#toggleJsonEditor(permissionId, 'userAttr');
  }

  applyUserAttr(permissionId: string, event: Event): void {
    this.#applyJsonEditor(permissionId, 'userAttr', event);
  }

  // ─── custom ───────────────────────────────────────────────────────────

  hasCustom(permissionId: string): boolean {
    return typeof this.conditionsMap().get(permissionId)?.custom === 'string';
  }

  getCustomText(permissionId: string): string {
    return this.conditionsMap().get(permissionId)?.custom ?? '';
  }

  getCustomError(permissionId: string): string {
    return this.jsonErrors().get(`${permissionId}:custom`) ?? '';
  }

  toggleCustom(permissionId: string): void {
    if (this.hasCustom(permissionId)) {
      this.#removeConditionKey(permissionId, 'custom');
      this.#clearJsonError(permissionId, 'custom');
    } else {
      this.#patchCondition(permissionId, {
        custom: '{\n  "$or": [{"status": "active"}, {"status": "pending"}]\n}'
      });
    }
  }

  onCustomChange(permissionId: string, text: string): void {
    if (!text.trim()) {
      this.#removeConditionKey(permissionId, 'custom');
      this.#clearJsonError(permissionId, 'custom');
      return;
    }

    try {
      JSON.parse(text);
      this.#patchCondition(permissionId, { custom: text });
      this.#clearJsonError(permissionId, 'custom');
    } catch {
      this.#setJsonError(
        permissionId,
        'custom',
        this.#translocoService.translate('admin.rolePermissions.invalidJson')
      );
      this.#patchCondition(permissionId, { custom: text });
    }
  }

  // ─── Save ─────────────────────────────────────────────────────────────

  save(): void {
    if (!this.canSave()) return;

    const conditions = this.conditionsMap();
    const items = [...this.selectedIds()].map((id) => ({
      permissionId: id,
      conditions: conditions.get(id) ?? null
    }));

    this.saving.set(true);
    this.#roleService
      .setPermissions(this.role.id, items)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.#dialogRef.close(true);
        },
        error: (err) => {
          this.saving.set(false);
          this.#notify.error(err, 'admin.rolePermissions.errorSaveFailed');
        }
      });
  }

  cancel(): void {
    this.#dialogRef.close(false);
  }

  // ─── Private ──────────────────────────────────────────────────────────

  #initState(rolePermissions: RolePermissionItem[]): void {
    const ids = new Set(rolePermissions.map((rp) => rp.permissionId));
    const condMap = new Map<string, PermissionCondition | null>(
      rolePermissions.map((rp) => [rp.permissionId, rp.conditions])
    );

    // Populate JSON text buffers from loaded conditions
    const fmTexts = new Map<string, string>();
    const uaTexts = new Map<string, string>();
    for (const [id, cond] of condMap) {
      if (cond?.fieldMatch) {
        fmTexts.set(id, JSON.stringify(cond.fieldMatch, null, 2));
      }
      if (cond?.userAttr) {
        uaTexts.set(id, JSON.stringify(cond.userAttr, null, 2));
      }
    }

    this.#originalIds = new Set(ids);
    this.#originalConditions = new Map(condMap);
    this.selectedIds.set(ids);
    this.conditionsMap.set(condMap);
    this.fieldMatchText.set(fmTexts);
    this.userAttrText.set(uaTexts);
  }

  #collapseAndClear(permissionId: string): void {
    const expanded = new Set(this.expandedIds());
    expanded.delete(permissionId);
    this.expandedIds.set(expanded);

    const map = new Map(this.conditionsMap());
    map.delete(permissionId);
    this.conditionsMap.set(map);

    this.#deleteEditorText(permissionId, 'fieldMatch');
    this.#deleteEditorText(permissionId, 'userAttr');

    const errors = new Map(this.jsonErrors());
    for (const key of [...errors.keys()]) {
      if (key.startsWith(`${permissionId}:`)) errors.delete(key);
    }
    this.jsonErrors.set(errors);
  }

  #editorTexts(editor: JsonObjectEditor): WritableSignal<Map<string, string>> {
    return editor === 'fieldMatch' ? this.fieldMatchText : this.userAttrText;
  }

  #editorPatch(
    editor: JsonObjectEditor,
    value: Record<string, unknown[]>
  ): Partial<PermissionCondition> {
    return editor === 'fieldMatch'
      ? { fieldMatch: value }
      : { userAttr: value };
  }

  #setEditorText(
    permissionId: string,
    editor: JsonObjectEditor,
    text: string
  ): void {
    const textsSignal = this.#editorTexts(editor);
    const texts = new Map(textsSignal());
    texts.set(permissionId, text);
    textsSignal.set(texts);
  }

  #deleteEditorText(permissionId: string, editor: JsonObjectEditor): void {
    const textsSignal = this.#editorTexts(editor);
    const texts = new Map(textsSignal());
    texts.delete(permissionId);
    textsSignal.set(texts);
  }

  #hasJsonEditor(permissionId: string, editor: JsonObjectEditor): boolean {
    return !!this.conditionsMap().get(permissionId)?.[editor];
  }

  #jsonEditorText(permissionId: string, editor: JsonObjectEditor): string {
    return this.#editorTexts(editor)().get(permissionId) ?? '';
  }

  #jsonEditorError(permissionId: string, editor: JsonObjectEditor): string {
    return this.jsonErrors().get(`${permissionId}:${editor}`) ?? '';
  }

  #toggleJsonEditor(permissionId: string, editor: JsonObjectEditor): void {
    if (this.#hasJsonEditor(permissionId, editor)) {
      this.#removeConditionKey(permissionId, editor);
      this.#deleteEditorText(permissionId, editor);
      this.#clearJsonError(permissionId, editor);
    } else {
      this.#patchCondition(permissionId, this.#editorPatch(editor, {}));
      this.#setEditorText(permissionId, editor, JSON_EDITOR_SEEDS[editor]);
    }
  }

  #applyJsonEditor(
    permissionId: string,
    editor: JsonObjectEditor,
    event: Event
  ): void {
    const text = (event.target as HTMLTextAreaElement).value;
    this.#setEditorText(permissionId, editor, text);

    if (!text.trim()) {
      this.#removeConditionKey(permissionId, editor);
      this.#clearJsonError(permissionId, editor);
      return;
    }

    try {
      const parsed = JSON.parse(text) as Record<string, unknown[]>;
      this.#patchCondition(permissionId, this.#editorPatch(editor, parsed));
      this.#clearJsonError(permissionId, editor);
    } catch {
      this.#setJsonError(
        permissionId,
        editor,
        this.#translocoService.translate(
          'admin.rolePermissions.invalidJsonObject'
        )
      );
    }
  }

  #patchCondition(
    permissionId: string,
    patch: Partial<PermissionCondition>
  ): void {
    const map = new Map(this.conditionsMap());
    const current = map.get(permissionId) ?? {};
    map.set(permissionId, { ...current, ...patch });
    this.conditionsMap.set(map);
  }

  #removeConditionKey<K extends keyof PermissionCondition>(
    permissionId: string,
    key: K
  ): void {
    const map = new Map(this.conditionsMap());
    const current = map.get(permissionId);
    if (!current) return;
    const next = { ...current };
    delete next[key];
    map.set(permissionId, Object.keys(next).length > 0 ? next : null);
    this.conditionsMap.set(map);
  }

  #setJsonError(permissionId: string, type: string, message: string): void {
    const errors = new Map(this.jsonErrors());
    errors.set(`${permissionId}:${type}`, message);
    this.jsonErrors.set(errors);
  }

  #clearJsonError(permissionId: string, type: string): void {
    const errors = new Map(this.jsonErrors());
    errors.delete(`${permissionId}:${type}`);
    this.jsonErrors.set(errors);
  }

  #groupByResource(permissions: PermissionResponse[]): PermissionGroup[] {
    const map = new Map<string, PermissionResponse[]>();
    for (const p of permissions) {
      const { allowedActionNames } = p.resource;
      const allowed =
        allowedActionNames !== null
          ? allowedActionNames.includes(p.action.name)
          : p.action.isDefault;
      if (!allowed) continue;

      const resourceName = p.resource.displayName || p.resource.name;
      if (!map.has(resourceName)) map.set(resourceName, []);
      map.get(resourceName)!.push(p);
    }
    return Array.from(map.entries()).map(([resource, perms]) => ({
      resource,
      permissions: perms
    }));
  }
}
