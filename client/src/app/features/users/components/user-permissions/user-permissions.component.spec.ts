import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';

import { UserPermissionsComponent } from './user-permissions.component';
import { UserService } from '../../services/user.service';
import { RbacMetadataStore } from '@features/auth/store/rbac-metadata.store';
import type {
  PermissionCondition,
  ResolvedPermission,
  ResourceResponse,
  RoleAdminResponse,
  UserEffectivePermissionsResponse
} from '@app/shared/types';

const mockRole: RoleAdminResponse = {
  id: 'role-user',
  name: 'user',
  description: 'Regular user',
  isSystem: true,
  isSuper: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

const mockSuperRole: RoleAdminResponse = {
  id: 'role-super',
  name: 'super',
  description: 'Super user',
  isSystem: true,
  isSuper: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

const mockResources: ResourceResponse[] = [
  {
    id: 'res-user',
    name: 'User',
    subject: 'User',
    displayName: 'Users',
    description: null,
    isSystem: true,
    isOrphaned: false,
    isRegistered: true,
    allowedActionNames: null,
    createdAt: '2024-01-01T00:00:00.000Z'
  },
  {
    id: 'res-role',
    name: 'Role',
    subject: 'Role',
    displayName: 'Roles',
    description: null,
    isSystem: true,
    isOrphaned: false,
    isRegistered: true,
    allowedActionNames: null,
    createdAt: '2024-01-01T00:00:00.000Z'
  }
];

const buildPermission = (
  resource: string,
  action: string,
  conditions: PermissionCondition | null = null
): ResolvedPermission => ({
  permission: `${resource}:${action}`,
  resource,
  action,
  conditions
});

describe('UserPermissionsComponent', () => {
  let component: UserPermissionsComponent;
  let fixture: ComponentFixture<UserPermissionsComponent>;
  let userServiceMock: {
    getPermissions: ReturnType<typeof vi.fn>;
  };
  let rbacMetadataStoreMock: {
    resources: ReturnType<typeof vi.fn>;
  };

  const createComponent = (
    response: UserEffectivePermissionsResponse | null,
    shouldError = false
  ): void => {
    userServiceMock.getPermissions = vi
      .fn()
      .mockReturnValue(
        shouldError ? throwError(() => new Error('fail')) : of(response)
      );

    fixture = TestBed.createComponent(UserPermissionsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', 'user-1');
    fixture.detectChanges();
  };

  beforeEach(() => {
    userServiceMock = { getPermissions: vi.fn() };
    rbacMetadataStoreMock = {
      resources: vi.fn().mockReturnValue(mockResources)
    };

    TestBed.configureTestingModule({
      imports: [UserPermissionsComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: UserService, useValue: userServiceMock },
        { provide: RbacMetadataStore, useValue: rbacMetadataStoreMock }
      ]
    });
  });

  it('should create', () => {
    createComponent({ roles: [], permissions: [], rules: [] });
    expect(component).toBeTruthy();
  });

  describe('fetching', () => {
    it('should call getPermissions with the id input on init', () => {
      createComponent({ roles: [], permissions: [], rules: [] });
      expect(userServiceMock.getPermissions).toHaveBeenCalledWith('user-1');
    });

    it('should set loading to false after success', () => {
      createComponent({ roles: [], permissions: [], rules: [] });
      expect(component.loading()).toBe(false);
      expect(component.error()).toBe(false);
    });

    it('should set error to true and loading to false on error', () => {
      createComponent(null, true);
      expect(component.loading()).toBe(false);
      expect(component.error()).toBe(true);
    });
  });

  describe('roles', () => {
    it('should expose roles from response', () => {
      createComponent({
        roles: [mockRole],
        permissions: [],
        rules: []
      });
      expect(component.roles()).toEqual([mockRole]);
    });

    it('should default to empty array when no data', () => {
      createComponent(null, true);
      expect(component.roles()).toEqual([]);
    });
  });

  describe('isSuper', () => {
    it('should be true when any role is super', () => {
      createComponent({
        roles: [mockRole, mockSuperRole],
        permissions: [],
        rules: []
      });
      expect(component.isSuper()).toBe(true);
    });

    it('should be false when no role is super', () => {
      createComponent({
        roles: [mockRole],
        permissions: [],
        rules: []
      });
      expect(component.isSuper()).toBe(false);
    });
  });

  describe('groups', () => {
    it('should group permissions by resource and apply displayName', () => {
      createComponent({
        roles: [mockRole],
        permissions: [
          buildPermission('User', 'read'),
          buildPermission('User', 'update'),
          buildPermission('Role', 'read')
        ],
        rules: []
      });

      const groups = component.groups();
      expect(groups).toHaveLength(2);
      // Groups are sorted by displayName: "Roles" then "Users"
      expect(groups[0]?.name).toBe('Role');
      expect(groups[0]?.displayName).toBe('Roles');
      expect(groups[1]?.name).toBe('User');
      expect(groups[1]?.displayName).toBe('Users');
      expect(groups[1]?.permissions.map((p) => p.action)).toEqual([
        'read',
        'update'
      ]);
    });

    it('should set hasDeny when any permission has effect=deny', () => {
      createComponent({
        roles: [mockRole],
        permissions: [
          buildPermission('User', 'read'),
          buildPermission('User', 'delete', { effect: 'deny' })
        ],
        rules: []
      });

      const groups = component.groups();
      expect(groups[0]?.hasDeny).toBe(true);
      expect(groups[0]?.denyCount).toBe(1);
      expect(groups[0]?.allowCount).toBe(1);
    });

    it('should fall back to resource name when displayName not found', () => {
      rbacMetadataStoreMock.resources.mockReturnValue([]);
      createComponent({
        roles: [mockRole],
        permissions: [buildPermission('Unknown', 'read')],
        rules: []
      });

      expect(component.groups()[0]?.displayName).toBe('Unknown');
    });

    it('should be empty when data is null', () => {
      createComponent(null, true);
      expect(component.groups()).toEqual([]);
    });
  });

  describe('summary', () => {
    it('should count allow/deny/conditional correctly', () => {
      createComponent({
        roles: [mockRole],
        permissions: [
          buildPermission('User', 'read'),
          buildPermission('User', 'update', { ownership: { userField: 'id' } }),
          buildPermission('User', 'delete', { effect: 'deny' })
        ],
        rules: []
      });

      expect(component.summary()).toEqual({
        allow: 2,
        deny: 1,
        conditional: 1
      });
    });

    it('should not count effect-only conditions as conditional', () => {
      createComponent({
        roles: [mockRole],
        permissions: [buildPermission('User', 'delete', { effect: 'deny' })],
        rules: []
      });

      expect(component.summary().conditional).toBe(0);
    });

    it('should return zeroes when no data', () => {
      createComponent(null, true);
      expect(component.summary()).toEqual({
        allow: 0,
        deny: 0,
        conditional: 0
      });
    });
  });

  describe('toggleAll', () => {
    it('should toggle expanded state', () => {
      createComponent({ roles: [], permissions: [], rules: [] });
      expect(component.expanded()).toBe(false);
      component.toggleAll();
      expect(component.expanded()).toBe(true);
      component.toggleAll();
      expect(component.expanded()).toBe(false);
    });
  });

  describe('hasRenderableConditions', () => {
    it('should return false for null', () => {
      createComponent({ roles: [], permissions: [], rules: [] });
      expect(component.hasRenderableConditions(null)).toBe(false);
    });

    it('should return false when only effect is set', () => {
      createComponent({ roles: [], permissions: [], rules: [] });
      expect(component.hasRenderableConditions({ effect: 'deny' })).toBe(false);
    });

    it('should return true when other keys are present', () => {
      createComponent({ roles: [], permissions: [], rules: [] });
      expect(
        component.hasRenderableConditions({ ownership: { userField: 'id' } })
      ).toBe(true);
    });
  });

  describe('formatConditions', () => {
    it('should strip the effect key and pretty-print', () => {
      createComponent({ roles: [], permissions: [], rules: [] });
      const result = component.formatConditions({
        effect: 'deny',
        ownership: { userField: 'id' }
      });
      expect(result).not.toContain('effect');
      expect(result).toContain('ownership');
      expect(result).toContain('userField');
    });
  });
});
