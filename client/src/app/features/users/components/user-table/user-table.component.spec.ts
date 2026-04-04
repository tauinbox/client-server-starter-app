import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { ComponentRef } from '@angular/core';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';

import { COLUMN_TO_SORT_MAP, UserTableComponent } from './user-table.component';
import { AuthStore } from '../../../auth/store/auth.store';
import type { User } from '../../models/user.types';
import type { RoleResponse } from '@app/shared/types';

const mockUserRole: RoleResponse = {
  id: 'role-user',
  name: 'user',
  description: 'Regular user',
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

  describe('instance-level permission checks', () => {
    it('should show edit button when hasPermissions returns true for the user instance', () => {
      authStoreMock.hasPermissions.mockReturnValue(true);
      componentRef.setInput('users', [mockUser]);
      fixture.detectChanges();

      const editButton = fixture.nativeElement.querySelector(
        'button[color="accent"]'
      );
      expect(editButton).toBeTruthy();
    });

    it('should hide edit and delete buttons when hasPermissions returns false', () => {
      authStoreMock.hasPermissions.mockReturnValue(false);
      componentRef.setInput('users', [mockUser]);
      fixture.detectChanges();

      const editButton = fixture.nativeElement.querySelector(
        'button[color="accent"]'
      );
      const deleteButton = fixture.nativeElement.querySelector(
        'button[color="warn"]'
      );
      expect(editButton).toBeNull();
      expect(deleteButton).toBeNull();
    });

    it('should show delete button when hasPermissions returns true for the user instance', () => {
      authStoreMock.hasPermissions.mockReturnValue(true);
      componentRef.setInput('users', [mockUser]);
      fixture.detectChanges();

      const deleteButton = fixture.nativeElement.querySelector(
        'button[color="warn"]'
      );
      expect(deleteButton).toBeTruthy();
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
