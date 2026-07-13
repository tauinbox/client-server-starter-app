import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslocoTestingModuleWithLangs } from '../../../../../../test-utils/transloco-testing';
import type {
  PermissionCondition,
  RoleAdminResponse
} from '@app/shared/types/role.types';
import { NotifyService } from '@core/services/notify.service';
import type { RolePermissionItem } from '../../../services/role.service';
import { RoleService } from '../../../services/role.service';
import { RolePermissionsDialogComponent } from './role-permissions-dialog.component';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockRole: RoleAdminResponse = {
  id: 'role-custom',
  name: 'Custom Role',
  description: null,
  isSystem: false,
  isSuper: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z'
};

const mockPermissionA = {
  id: 'perm-a',
  resource: {
    id: 'res-1',
    name: 'users',
    subject: 'User',
    displayName: 'Users',
    description: null,
    isSystem: true,
    isOrphaned: false,
    isRegistered: true,
    allowedActionNames: null,
    createdAt: '2025-01-01T00:00:00.000Z'
  },
  action: {
    id: 'act-1',
    name: 'read',
    displayName: 'Read',
    description: 'Read access',
    isDefault: true,
    createdAt: '2025-01-01T00:00:00.000Z'
  },
  description: null,
  createdAt: '2025-01-01T00:00:00.000Z'
};

const mockPermissionB = {
  id: 'perm-b',
  resource: mockPermissionA.resource,
  action: {
    id: 'act-2',
    name: 'create',
    displayName: 'Create',
    description: 'Create access',
    isDefault: true,
    createdAt: '2025-01-01T00:00:00.000Z'
  },
  description: null,
  createdAt: '2025-01-01T00:00:00.000Z'
};

/** A well-formed RolePermissionItem as the real server returns. */
function makeRolePermItem(permissionId: string): RolePermissionItem {
  const perm = permissionId === 'perm-a' ? mockPermissionA : mockPermissionB;
  return {
    id: `rp-${permissionId}`,
    roleId: mockRole.id,
    permissionId,
    conditions: null,
    permission: perm
  };
}

/** Builds a blur event whose target is a real textarea carrying `value`. */
function textareaBlurEvent(value: string): Event {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  const event = new Event('blur');
  textarea.dispatchEvent(event);
  return event;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

function setup(
  rolePermItems: RolePermissionItem[],
  options: { readonly?: boolean } = {}
) {
  const roleServiceMock = {
    getAllPermissions: vi
      .fn()
      .mockReturnValue(of([mockPermissionA, mockPermissionB])),
    getRolePermissions: vi.fn().mockReturnValue(of(rolePermItems)),
    setPermissions: vi.fn().mockReturnValue(of(undefined))
  };
  const dialogRefMock = { close: vi.fn() };
  const notifyMock = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  };

  const dialogData =
    options.readonly !== undefined
      ? { role: mockRole, readonly: options.readonly }
      : { role: mockRole };

  TestBed.configureTestingModule({
    imports: [RolePermissionsDialogComponent, TranslocoTestingModuleWithLangs],
    providers: [
      provideNoopAnimations(),
      { provide: MAT_DIALOG_DATA, useValue: dialogData },
      { provide: MatDialogRef, useValue: dialogRefMock },
      { provide: RoleService, useValue: roleServiceMock },
      { provide: NotifyService, useValue: notifyMock }
    ]
  });

  const fixture = TestBed.createComponent(RolePermissionsDialogComponent);
  fixture.detectChanges();
  // forkJoin completes synchronously with of()
  fixture.detectChanges();

  return {
    fixture,
    component: fixture.componentInstance,
    roleServiceMock,
    dialogRefMock
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RolePermissionsDialogComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  describe('initialisation from server response', () => {
    it('populates selectedIds from permissionId fields in the server response', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      expect(component.selectedIds().has('perm-a')).toBe(true);
      expect(component.selectedIds().size).toBe(1);
    });

    it('marks the correct checkboxes as checked', () => {
      const { component } = setup([
        makeRolePermItem('perm-a'),
        makeRolePermItem('perm-b')
      ]);

      expect(component.isChecked('perm-a')).toBe(true);
      expect(component.isChecked('perm-b')).toBe(true);
    });

    it('does not mark unchecked permissions as selected', () => {
      // Only perm-a is assigned to the role
      const { component } = setup([makeRolePermItem('perm-a')]);

      expect(component.isChecked('perm-b')).toBe(false);
    });
  });

  describe('save() payload', () => {
    it('sends permissionId (not undefined) for every item in the PUT body', () => {
      const { component, roleServiceMock } = setup([
        makeRolePermItem('perm-a')
      ]);

      // Toggle perm-b to make form dirty
      component.togglePermission('perm-b');
      component.save();

      expect(roleServiceMock.setPermissions).toHaveBeenCalledOnce();
      const [, items] = roleServiceMock.setPermissions.mock.calls[0] as [
        string,
        { permissionId: string; conditions: null }[]
      ];
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.permissionId).toBeDefined();
        expect(typeof item.permissionId).toBe('string');
        expect(item.permissionId.length).toBeGreaterThan(0);
      }
    });

    it('includes the newly toggled permission in the payload', () => {
      const { component, roleServiceMock } = setup([
        makeRolePermItem('perm-a')
      ]);

      component.togglePermission('perm-b');
      component.save();

      const [, items] = roleServiceMock.setPermissions.mock.calls[0] as [
        string,
        { permissionId: string; conditions: null }[]
      ];
      const ids = items.map((i) => i.permissionId);
      expect(ids).toContain('perm-a');
      expect(ids).toContain('perm-b');
    });

    it('does not send items without permissionId — regression for mock-server bug', () => {
      // Simulates what would happen if the server returned items without permissionId.
      // The client receives { id, roleId, permissionId: undefined, ... } which means
      // selectedIds gets populated with `undefined` as a key, and the PUT payload
      // would contain { conditions: null } with no permissionId field.
      const brokenItems = [
        {
          // permissionId deliberately absent — as the mock-server bug produced
          id: 'rp-broken',
          roleId: mockRole.id,
          conditions: null,
          permission: mockPermissionA
        } as unknown as RolePermissionItem
      ];

      const { component, roleServiceMock } = setup(brokenItems);

      // The undefined key ends up in selectedIds; toggle another perm to make it dirty
      component.togglePermission('perm-b');
      component.save();

      const [, items] = roleServiceMock.setPermissions.mock.calls[0] as [
        string,
        { permissionId: string; conditions: null }[]
      ];
      // With the bug, one of the items would have permissionId === undefined
      const hasUndefinedId = items.some(
        (i) => i.permissionId === undefined || i.permissionId === 'undefined'
      );
      expect(hasUndefinedId).toBe(true); // documents the BROKEN behaviour
    });

    it('sends the role id as the first argument to setPermissions', () => {
      const { component, roleServiceMock } = setup([
        makeRolePermItem('perm-a')
      ]);

      component.togglePermission('perm-b');
      component.save();

      const [roleId] = roleServiceMock.setPermissions.mock.calls[0] as [
        string,
        unknown[]
      ];
      expect(roleId).toBe(mockRole.id);
    });

    it('closes the dialog with true on success', () => {
      const { component, dialogRefMock } = setup([makeRolePermItem('perm-a')]);

      component.togglePermission('perm-b');
      component.save();

      expect(dialogRefMock.close).toHaveBeenCalledWith(true);
    });
  });

  describe('dirty detection', () => {
    it('is not dirty on initial load', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      expect(component.isDirty()).toBe(false);
    });

    it('becomes dirty when a permission is toggled', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      component.togglePermission('perm-b');

      expect(component.isDirty()).toBe(true);
    });

    it('save button is disabled when not dirty', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      expect(component.canSave()).toBe(false);
    });

    it('save button is enabled after toggling a permission', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      component.togglePermission('perm-b');

      expect(component.canSave()).toBe(true);
    });
  });

  describe('readonly mode', () => {
    it('isReadonly() is false by default when readonly is not provided', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      // @ts-expect-error accessing protected signal for assertion
      expect(component.isReadonly()).toBe(false);
    });

    it('isReadonly() is true when readonly: true is passed in data', () => {
      const { component } = setup([makeRolePermItem('perm-a')], {
        readonly: true
      });

      // @ts-expect-error accessing protected signal for assertion
      expect(component.isReadonly()).toBe(true);
    });

    it('canSave() is false even when dirty if readonly: true', () => {
      const { component } = setup([makeRolePermItem('perm-a')], {
        readonly: true
      });

      // Attempt to make dirty — togglePermission respects isSystem, not isReadonly
      component.togglePermission('perm-b');

      expect(component.canSave()).toBe(false);
    });

    it('save() does NOT call roleService.setPermissions when readonly: true', () => {
      const { component, roleServiceMock } = setup(
        [makeRolePermItem('perm-a')],
        { readonly: true }
      );

      component.togglePermission('perm-b');
      component.save();

      expect(roleServiceMock.setPermissions).not.toHaveBeenCalled();
    });

    it('save button is absent from DOM when readonly: true', () => {
      const { fixture } = setup([makeRolePermItem('perm-a')], {
        readonly: true
      });

      const saveButton = fixture.nativeElement.querySelector(
        'button[matButton="filled"]'
      );
      expect(saveButton).toBeNull();
    });

    it('readonly notice is present in DOM when readonly: true', () => {
      const { fixture } = setup([makeRolePermItem('perm-a')], {
        readonly: true
      });

      const content: string = fixture.nativeElement.textContent ?? '';
      expect(content).toContain('You have read-only access');
    });

    it('readonly notice is absent when readonly: false', () => {
      const { fixture } = setup([makeRolePermItem('perm-a')], {
        readonly: false
      });

      const content: string = fixture.nativeElement.textContent ?? '';
      expect(content).not.toContain('You have read-only access');
    });

    it('component.isReadonly() is true and checkboxes carry disabled attribute when readonly: true', () => {
      const { component, fixture } = setup([makeRolePermItem('perm-a')], {
        readonly: true
      });

      // @ts-expect-error accessing protected signal for assertion
      expect(component.isReadonly()).toBe(true);

      // At least one mat-checkbox input should be disabled
      const checkboxInputs: NodeListOf<HTMLInputElement> =
        fixture.nativeElement.querySelectorAll('mat-checkbox input');
      const anyDisabled = Array.from(checkboxInputs).some((el) => el.disabled);
      expect(anyDisabled).toBe(true);
    });
  });

  describe('effect (allow / deny)', () => {
    it('isDeny() returns false when no effect is set', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      expect(component.isDeny('perm-a')).toBe(false);
    });

    it('setEffect("deny") marks the permission as deny and dirties the form', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      component.setEffect('perm-a', 'deny');

      expect(component.isDeny('perm-a')).toBe(true);
      expect(component.isDirty()).toBe(true);
    });

    it('setEffect("allow") strips the effect field and collapses conditions to null when nothing else remains', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      component.setEffect('perm-a', 'deny');
      component.setEffect('perm-a', 'allow');

      expect(component.isDeny('perm-a')).toBe(false);
      // conditions must be null (matches the original empty state) — not an
      // empty object, otherwise dirty detection would stay true forever.
      expect(component.isDirty()).toBe(false);
    });

    it('setEffect preserves other condition keys when flipping back to allow', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      component.setEffect('perm-a', 'deny');
      component.toggleOwnership('perm-a');
      component.setEffect('perm-a', 'allow');

      expect(component.isDeny('perm-a')).toBe(false);
      expect(component.hasOwnership('perm-a')).toBe(true);
    });

    it('save() sends conditions with effect: "deny" in payload', () => {
      const { component, roleServiceMock } = setup([
        makeRolePermItem('perm-a')
      ]);

      component.setEffect('perm-a', 'deny');
      component.save();

      const [, items] = roleServiceMock.setPermissions.mock.calls[0] as [
        string,
        { permissionId: string; conditions: { effect?: string } | null }[]
      ];
      const item = items.find((i) => i.permissionId === 'perm-a');
      expect(item?.conditions?.effect).toBe('deny');
    });

    it('hasAnyCondition() ignores effect (it is not a restriction)', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      component.setEffect('perm-a', 'deny');

      // deny alone is not a "restriction condition" — the condition chip must
      // not appear just because effect is set.
      expect(component.hasAnyCondition('perm-a')).toBe(false);
    });

    it('initialises isDeny() from server response containing effect', () => {
      const denyItem: RolePermissionItem = {
        ...makeRolePermItem('perm-a'),
        conditions: { effect: 'deny' }
      };
      const { component } = setup([denyItem]);

      expect(component.isDeny('perm-a')).toBe(true);
      expect(component.isDirty()).toBe(false);
    });

    it('setEffect is a no-op for system roles', () => {
      const systemRole: RoleAdminResponse = { ...mockRole, isSystem: true };
      const roleServiceMock = {
        getAllPermissions: vi
          .fn()
          .mockReturnValue(of([mockPermissionA, mockPermissionB])),
        getRolePermissions: vi.fn().mockReturnValue(of([])),
        setPermissions: vi.fn().mockReturnValue(of(undefined))
      };
      TestBed.configureTestingModule({
        imports: [
          RolePermissionsDialogComponent,
          TranslocoTestingModuleWithLangs
        ],
        providers: [
          provideNoopAnimations(),
          { provide: MAT_DIALOG_DATA, useValue: { role: systemRole } },
          { provide: MatDialogRef, useValue: { close: vi.fn() } },
          { provide: RoleService, useValue: roleServiceMock },
          {
            provide: NotifyService,
            useValue: {
              success: vi.fn(),
              error: vi.fn(),
              info: vi.fn(),
              warn: vi.fn()
            }
          }
        ]
      });
      const fixture = TestBed.createComponent(RolePermissionsDialogComponent);
      fixture.detectChanges();
      fixture.detectChanges();
      const component = fixture.componentInstance;

      component.setEffect('perm-a', 'deny');

      expect(component.isDeny('perm-a')).toBe(false);
    });
  });

  type Comp = RolePermissionsDialogComponent;

  describe.each([
    {
      name: 'fieldMatch' as const,
      seed: '{\n  "fieldName": ["value1", "value2"]\n}',
      seedValue: { fieldName: ['value1', 'value2'] },
      validText: '{ "field": ["a", "b"] }',
      validValue: { field: ['a', 'b'] },
      invalidShapeText: '{ "status": ["active"], "dept": "sales" }',
      has: (c: Comp, id: string) => c.hasFieldMatch(id),
      getText: (c: Comp, id: string) => c.getFieldMatchText(id),
      getError: (c: Comp, id: string) => c.getFieldMatchError(id),
      toggle: (c: Comp, id: string) => c.toggleFieldMatch(id),
      apply: (c: Comp, id: string, value: string) =>
        c.applyFieldMatch(id, textareaBlurEvent(value)),
      condValue: (c: Comp, id: string) => c.conditionsMap().get(id)?.fieldMatch,
      makeCondition: (v: Record<string, unknown[]>): PermissionCondition => ({
        fieldMatch: v
      })
    },
    {
      name: 'userAttr' as const,
      seed: '{\n  "recordField": "id"\n}',
      seedValue: { recordField: 'id' },
      validText: '{ "ownerId": "id" }',
      validValue: { ownerId: 'id' },
      invalidShapeText: '{ "ownerId": 123 }',
      has: (c: Comp, id: string) => c.hasUserAttr(id),
      getText: (c: Comp, id: string) => c.getUserAttrText(id),
      getError: (c: Comp, id: string) => c.getUserAttrError(id),
      toggle: (c: Comp, id: string) => c.toggleUserAttr(id),
      apply: (c: Comp, id: string, value: string) =>
        c.applyUserAttr(id, textareaBlurEvent(value)),
      condValue: (c: Comp, id: string) => c.conditionsMap().get(id)?.userAttr,
      makeCondition: (v: Record<string, unknown[]>): PermissionCondition => ({
        userAttr: v
      })
    }
  ])('$name JSON editor', (editor) => {
    it('toggle on seeds the default JSON template and the matching condition', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      editor.toggle(component, 'perm-a');

      expect(editor.has(component, 'perm-a')).toBe(true);
      expect(editor.getText(component, 'perm-a')).toBe(editor.seed);
      // WYSIWYG: the patched condition equals the parsed seed text, so saving
      // an untouched editor sends exactly what the textarea shows
      expect(editor.condValue(component, 'perm-a')).toEqual(editor.seedValue);
    });

    it('valid JSON patches the condition and clears a previous error', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      editor.toggle(component, 'perm-a');
      editor.apply(component, 'perm-a', '{ not json');
      editor.apply(component, 'perm-a', editor.validText);

      expect(editor.condValue(component, 'perm-a')).toEqual(editor.validValue);
      expect(editor.getError(component, 'perm-a')).toBe('');
      expect(component.canSave()).toBe(true);
    });

    it('invalid JSON sets the keyed error, keeps the text and disables save', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      editor.toggle(component, 'perm-a');
      editor.apply(component, 'perm-a', '{ not json');

      expect(editor.getError(component, 'perm-a')).not.toBe('');
      expect(component.jsonErrors().has(`perm-a:${editor.name}`)).toBe(true);
      expect(editor.getText(component, 'perm-a')).toBe('{ not json');
      // condition keeps the last valid value (the seed from toggle)
      expect(editor.condValue(component, 'perm-a')).toEqual(editor.seedValue);
      expect(component.canSave()).toBe(false);
    });

    it('valid JSON with a malformed shape sets the error and does not patch', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      editor.toggle(component, 'perm-a');
      editor.apply(component, 'perm-a', editor.invalidShapeText);

      expect(editor.getError(component, 'perm-a')).not.toBe('');
      expect(editor.condValue(component, 'perm-a')).toEqual(editor.seedValue);
      expect(component.canSave()).toBe(false);
    });

    it('an empty object is a shape error (rejected by the server too)', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      editor.toggle(component, 'perm-a');
      editor.apply(component, 'perm-a', '{}');

      expect(editor.getError(component, 'perm-a')).not.toBe('');
      expect(component.canSave()).toBe(false);
    });

    it('clearing the text removes the condition key and the error', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      editor.toggle(component, 'perm-a');
      editor.apply(component, 'perm-a', '{ not json');
      editor.apply(component, 'perm-a', '   ');

      expect(editor.has(component, 'perm-a')).toBe(false);
      expect(editor.getError(component, 'perm-a')).toBe('');
      // condition collapsed back to null — matches the original state
      expect(component.isDirty()).toBe(false);
    });

    it('toggle off removes the condition key, text buffer and error', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      editor.toggle(component, 'perm-a');
      editor.apply(component, 'perm-a', '{ not json');
      editor.toggle(component, 'perm-a');

      expect(editor.has(component, 'perm-a')).toBe(false);
      expect(editor.getText(component, 'perm-a')).toBe('');
      expect(editor.getError(component, 'perm-a')).toBe('');
      expect(component.isDirty()).toBe(false);
    });

    it('initialises the text buffer from loaded conditions', () => {
      const item = {
        ...makeRolePermItem('perm-a'),
        conditions: editor.makeCondition({ foo: ['bar'] })
      };
      const { component } = setup([item]);

      expect(editor.has(component, 'perm-a')).toBe(true);
      expect(editor.getText(component, 'perm-a')).toBe(
        JSON.stringify({ foo: ['bar'] }, null, 2)
      );
      expect(component.isDirty()).toBe(false);
    });
  });

  describe('ownership field validation', () => {
    function inputEvent(value: string): Event {
      const input = document.createElement('input');
      input.value = value;
      const event = new Event('input');
      input.dispatchEvent(event);
      return event;
    }

    it('an empty field name sets the keyed error and disables save', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      component.toggleOwnership('perm-a');
      component.setOwnershipField('perm-a', inputEvent(''));

      expect(component.getOwnershipError('perm-a')).not.toBe('');
      expect(component.jsonErrors().has('perm-a:ownership')).toBe(true);
      expect(component.canSave()).toBe(false);
    });

    it('a valid field name clears the error and re-enables save', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      component.toggleOwnership('perm-a');
      component.setOwnershipField('perm-a', inputEvent(''));
      component.setOwnershipField('perm-a', inputEvent('createdBy'));

      expect(component.getOwnershipError('perm-a')).toBe('');
      expect(component.getOwnershipField('perm-a')).toBe('createdBy');
      expect(component.canSave()).toBe(true);
    });

    it('toggling ownership off clears the error', () => {
      const { component } = setup([makeRolePermItem('perm-a')]);

      component.toggleOwnership('perm-a');
      component.setOwnershipField('perm-a', inputEvent(''));
      component.toggleOwnership('perm-a');

      expect(component.getOwnershipError('perm-a')).toBe('');
      expect(component.jsonErrors().size).toBe(0);
    });
  });
});
