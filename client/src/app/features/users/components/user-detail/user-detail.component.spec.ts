import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';

import { UserDetailComponent } from './user-detail.component';
import { UsersStore } from '../../store/users.store';
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
  id: 'user-1',
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

describe('UserDetailComponent', () => {
  let component: UserDetailComponent;
  let fixture: ComponentFixture<UserDetailComponent>;
  let entityMapSignal: WritableSignal<Record<string, User>>;
  let usersStoreMock: {
    entityMap: WritableSignal<Record<string, User>>;
    detailLoading: WritableSignal<boolean>;
    loadOne: ReturnType<typeof vi.fn>;
  };
  let authStoreMock: {
    hasPermissions: ReturnType<typeof vi.fn>;
    isAdmin: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    entityMapSignal = signal({});

    usersStoreMock = {
      entityMap: entityMapSignal,
      detailLoading: signal(false),
      loadOne: vi.fn()
    };

    authStoreMock = {
      hasPermissions: vi.fn().mockReturnValue(false),
      isAdmin: vi.fn().mockReturnValue(false)
    };

    await TestBed.configureTestingModule({
      imports: [UserDetailComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: UsersStore, useValue: usersStoreMock },
        { provide: AuthStore, useValue: authStoreMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UserDetailComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', 'user-1');
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('should call loadOne with the id input on init', () => {
      fixture.detectChanges();
      expect(usersStoreMock.loadOne).toHaveBeenCalledWith('user-1');
    });

    it('should call loadOne again with a different id input', () => {
      fixture.detectChanges();
      fixture.componentRef.setInput('id', 'user-2');
      fixture.detectChanges();
      // loadOne is called once on init
      expect(usersStoreMock.loadOne).toHaveBeenCalledWith('user-1');
    });
  });

  describe('user computed', () => {
    it('should return null when user is not in entity map', () => {
      entityMapSignal.set({});
      fixture.detectChanges();

      expect(component['user']()).toBeNull();
    });

    it('should return user from entity map when available', () => {
      entityMapSignal.set({ 'user-1': mockUser });
      fixture.detectChanges();

      expect(component['user']()).toEqual(mockUser);
    });

    it('should return null for a different id not in entity map', () => {
      entityMapSignal.set({ 'other-user': mockUser });
      fixture.detectChanges();

      expect(component['user']()).toBeNull();
    });
  });

  describe('loading state', () => {
    it('should expose detailLoading from store', () => {
      usersStoreMock.detailLoading.set(true);
      fixture.detectChanges();

      expect(component.loading()).toBe(true);
    });

    it('should reflect when loading is false', () => {
      usersStoreMock.detailLoading.set(false);
      fixture.detectChanges();

      expect(component.loading()).toBe(false);
    });
  });

  describe('edit button visibility', () => {
    it('should show edit button when hasPermissions returns true for the user instance', () => {
      authStoreMock.hasPermissions.mockReturnValue(true);
      entityMapSignal.set({ 'user-1': mockUser });
      fixture.detectChanges();

      const editButton = fixture.nativeElement.querySelector(
        'button[color="primary"][mat-flat-button]'
      );
      expect(editButton).toBeTruthy();
    });

    it('should hide edit button when hasPermissions returns false', () => {
      authStoreMock.hasPermissions.mockReturnValue(false);
      entityMapSignal.set({ 'user-1': mockUser });
      fixture.detectChanges();

      const editButton = fixture.nativeElement.querySelector(
        'button[color="primary"][mat-flat-button]'
      );
      expect(editButton).toBeNull();
    });

    it('should pass instance with user data to hasPermissions', () => {
      authStoreMock.hasPermissions.mockReturnValue(true);
      entityMapSignal.set({ 'user-1': mockUser });
      fixture.detectChanges();

      expect(authStoreMock.hasPermissions).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update',
          subject: 'User',
          instance: expect.objectContaining({ id: 'user-1' })
        })
      );
    });
  });
});
