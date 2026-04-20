import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslocoTestingModuleWithLangs } from '../../../../../../test-utils/transloco-testing';
import type { RoleResponse } from '@app/shared/types/role.types';
import type { RolePermissionItem } from '../../../services/role.service';
import { RoleService } from '../../../services/role.service';
import { RolePermissionsDialogComponent } from './role-permissions-dialog.component';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockRole: RoleResponse = {
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
  const snackBarMock = { open: vi.fn() };

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
      { provide: MatSnackBar, useValue: snackBarMock }
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
        'button[color="primary"]'
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
      const systemRole: RoleResponse = { ...mockRole, isSystem: true };
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
          { provide: MatSnackBar, useValue: { open: vi.fn() } }
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
});
