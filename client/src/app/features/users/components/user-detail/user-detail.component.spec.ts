import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';

import { UserDetailComponent } from './user-detail.component';
import { UsersStore } from '../../store/users.store';
import type { User } from '../../models/user.types';

const mockUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  isAdmin: false,
  roles: ['user'],
  isActive: true,
  isEmailVerified: true,
  failedLoginAttempts: 0,
  lockedUntil: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
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

  beforeEach(async () => {
    entityMapSignal = signal({});

    usersStoreMock = {
      entityMap: entityMapSignal,
      detailLoading: signal(false),
      loadOne: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [UserDetailComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: UsersStore, useValue: usersStoreMock }
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
});
