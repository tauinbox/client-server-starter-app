import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { ComponentRef } from '@angular/core';

import { COLUMN_TO_SORT_MAP, UserTableComponent } from './user-table.component';
import type { User } from '../../models/user.types';

const mockUser: User = {
  id: 'test-user-id',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  roles: ['user'],
  isActive: true,
  isEmailVerified: true,
  failedLoginAttempts: 0,
  lockedUntil: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

describe('UserTableComponent', () => {
  let component: UserTableComponent;
  let componentRef: ComponentRef<UserTableComponent>;
  let fixture: ComponentFixture<UserTableComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserTableComponent],
      providers: [provideRouter([]), provideNoopAnimations()]
    }).compileComponents();

    fixture = TestBed.createComponent(UserTableComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;

    componentRef.setInput('users', []);
    componentRef.setInput('totalItems', 0);
    componentRef.setInput('currentPage', 0);
    componentRef.setInput('pageSize', 10);

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

    it('should accept totalItems input', () => {
      componentRef.setInput('totalItems', 42);
      fixture.detectChanges();
      expect(component.totalItems()).toBe(42);
    });

    it('should accept currentPage input', () => {
      componentRef.setInput('currentPage', 3);
      fixture.detectChanges();
      expect(component.currentPage()).toBe(3);
    });

    it('should accept pageSize input', () => {
      componentRef.setInput('pageSize', 25);
      fixture.detectChanges();
      expect(component.pageSize()).toBe(25);
    });
  });

  describe('outputs', () => {
    it('should have pageChange output', () => {
      expect(component.pageChange).toBeDefined();
    });

    it('should have sortChange output', () => {
      expect(component.sortChange).toBeDefined();
    });

    it('should have deleteUser output', () => {
      expect(component.deleteUser).toBeDefined();
    });
  });
});
