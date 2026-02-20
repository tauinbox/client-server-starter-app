import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { ComponentRef } from '@angular/core';

import { UserTableComponent } from './user-table.component';

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
    const mockUser = {
      id: 'test-user-id',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      isAdmin: false,
      isActive: true,
      isEmailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    };

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
});
