import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { ComponentRef } from '@angular/core';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';

import { COLUMN_TO_SORT_MAP, UserTableComponent } from './user-table.component';
import { AuthStore } from '../../../auth/store/auth.store';
import type { User } from '../../models/user.types';
import type { RoleAdminResponse } from '@app/shared/types';
import { SYSTEM_ROLES } from '@app/shared/constants';

const mockUserRole: RoleAdminResponse = {
  id: 'role-user',
  name: SYSTEM_ROLES.USER,
  description: 'Regular user',
  isSystem: true,
  isSuper: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

const mockAdminRole: RoleAdminResponse = {
  id: 'role-admin',
  name: SYSTEM_ROLES.ADMIN,
  description: 'Administrator',
  isSystem: true,
  isSuper: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

const mockUser: User = {
  id: 'test-user-id',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  roles: [mockUserRole],
  isActive: true,
  isEmailVerified: true,
  lockedUntil: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  deletedAt: null
};

const otherUser: User = {
  ...mockUser,
  id: 'other-user-id',
  email: 'other@example.com',
  firstName: 'Other',
  lastName: 'Person'
};

describe('UserTableComponent', () => {
  let component: UserTableComponent;
  let componentRef: ComponentRef<UserTableComponent>;
  let fixture: ComponentFixture<UserTableComponent>;
  let authStoreMock: {
    hasPermissions: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authStoreMock = {
      hasPermissions: vi.fn().mockReturnValue(false)
    };

    await TestBed.configureTestingModule({
      imports: [UserTableComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AuthStore, useValue: authStoreMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UserTableComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;

    componentRef.setInput('users', []);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have all 7 displayed columns', () => {
    expect(component.displayedColumns).toEqual([
      'id',
      'email',
      'name',
      'status',
      'role',
      'createdAt',
      'actions'
    ]);
  });

  describe('trackById', () => {
    it('should return user id', () => {
      const result = component.trackById(0, mockUser);
      expect(result).toBe('test-user-id');
    });

    it('should return different ids for different users', () => {
      const user1 = { ...mockUser, id: 'user-1' };
      const user2 = { ...mockUser, id: 'user-2' };

      expect(component.trackById(0, user1)).toBe('user-1');
      expect(component.trackById(0, user2)).toBe('user-2');
    });
  });

  describe('COLUMN_TO_SORT_MAP', () => {
    it('should map email column to email sort key', () => {
      expect(COLUMN_TO_SORT_MAP['email']).toBe('email');
    });

    it('should map name column to firstName sort key', () => {
      expect(COLUMN_TO_SORT_MAP['name']).toBe('firstName');
    });

    it('should map status column to isActive sort key', () => {
      expect(COLUMN_TO_SORT_MAP['status']).toBe('isActive');
    });

    it('should map createdAt column to createdAt sort key', () => {
      expect(COLUMN_TO_SORT_MAP['createdAt']).toBe('createdAt');
    });
  });

  describe('inputs', () => {
    it('should accept users input', () => {
      componentRef.setInput('users', [mockUser]);
      fixture.detectChanges();
      expect(component.users()).toEqual([mockUser]);
    });
  });

  describe('outputs', () => {
    it('should have sortChange output', () => {
      expect(component.sortChange).toBeDefined();
    });

    it('should have deleteUser output', () => {
      expect(component.deleteUser).toBeDefined();
    });
  });

  describe('isAdmin', () => {
    it('returns true when a role.name matches SYSTEM_ROLES.ADMIN', () => {
      const adminUser: User = { ...mockUser, roles: [mockAdminRole] };
      expect(component.isAdmin(adminUser)).toBe(true);
    });

    it('returns false when no role matches SYSTEM_ROLES.ADMIN', () => {
      expect(component.isAdmin(mockUser)).toBe(false);
    });

    it('returns false when roles is empty', () => {
      const userWithoutRoles: User = { ...mockUser, roles: [] };
      expect(component.isAdmin(userWithoutRoles)).toBe(false);
    });

    // The detection used to use a hardcoded 'admin' literal, so renaming the
    // system role would silently break the chip. By keying off
    // SYSTEM_ROLES.ADMIN, an arbitrary role name like 'super' must NOT match —
    // even if it was the previous super-admin role — until the constant changes.
    it('does not match a role whose name differs from SYSTEM_ROLES.ADMIN', () => {
      const renamed: User = {
        ...mockUser,
        roles: [{ ...mockAdminRole, name: 'super' }]
      };
      expect(SYSTEM_ROLES.ADMIN).not.toBe('super');
      expect(component.isAdmin(renamed)).toBe(false);
    });
  });

  // The role column previously used user.roles?.includes('admin'), which
  // always returned false when the server returned RoleAdminResponse[] objects
  // (the true wire format). This test renders the table and verifies the
  // admin chip appears for RoleAdminResponse[].
  describe('role column rendering for RoleAdminResponse[]', () => {
    it('should render the Admin chip for a user with a RoleAdminResponse admin role', () => {
      const adminUser: User = {
        ...mockUser,
        id: 'admin-user',
        roles: [mockAdminRole]
      };
      componentRef.setInput('users', [adminUser]);
      fixture.detectChanges();

      const chips = fixture.nativeElement.querySelectorAll(
        'mat-chip[highlighted]'
      );
      const adminChip = Array.from(chips).find(
        (el) => (el as HTMLElement).textContent?.trim() === 'Admin'
      );
      expect(adminChip).toBeTruthy();
    });

    it('should render the User chip when roles does not include admin', () => {
      componentRef.setInput('users', [mockUser]);
      fixture.detectChanges();

      const userChips = fixture.nativeElement.querySelectorAll('mat-chip');
      const plainChip = Array.from(userChips).find(
        (el) => (el as HTMLElement).textContent?.trim() === 'User'
      );
      expect(plainChip).toBeTruthy();
    });
  });

  describe('instance-level permission checks', () => {
    const findEditButton = (root: HTMLElement): HTMLElement | null =>
      Array.from(root.querySelectorAll<HTMLElement>('button')).find(
        (b) => b.querySelector('mat-icon')?.textContent?.trim() === 'edit'
      ) ?? null;

    const findDeleteButton = (root: HTMLElement): HTMLElement | null =>
      root.querySelector('button.app-btn-danger');

    it('should show edit button when hasPermissions returns true for the user instance', () => {
      authStoreMock.hasPermissions.mockReturnValue(true);
      componentRef.setInput('users', [mockUser]);
      fixture.detectChanges();

      expect(findEditButton(fixture.nativeElement)).toBeTruthy();
    });

    it('should hide edit and delete buttons when hasPermissions returns false', () => {
      authStoreMock.hasPermissions.mockReturnValue(false);
      componentRef.setInput('users', [mockUser]);
      fixture.detectChanges();

      expect(findEditButton(fixture.nativeElement)).toBeNull();
      expect(findDeleteButton(fixture.nativeElement)).toBeNull();
    });

    it('should show delete button when hasPermissions returns true for the user instance', () => {
      authStoreMock.hasPermissions.mockReturnValue(true);
      componentRef.setInput('users', [mockUser]);
      fixture.detectChanges();

      expect(findDeleteButton(fixture.nativeElement)).toBeTruthy();
    });

    it('should call hasPermissions with instance data for each row', () => {
      authStoreMock.hasPermissions.mockReturnValue(true);
      componentRef.setInput('users', [mockUser, otherUser]);
      fixture.detectChanges();

      // update + delete for each of 2 rows = at least 4 calls
      expect(authStoreMock.hasPermissions).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update',
          subject: 'User',
          instance: expect.objectContaining({ id: 'test-user-id' })
        })
      );
      expect(authStoreMock.hasPermissions).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'delete',
          subject: 'User',
          instance: expect.objectContaining({ id: 'other-user-id' })
        })
      );
    });
  });
});
