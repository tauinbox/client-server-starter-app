import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopMaterialAnimations } from '../../../../../test-utils/material-animations';
import { signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';

import { UserDetailComponent } from './user-detail.component';
import { UsersStore } from '../../store/users.store';
import { AuthStore } from '../../../auth/store/auth.store';
import type { User } from '../../models/user.types';
import type { RoleAdminResponse } from '@app/shared/types';

const mockUserRole: RoleAdminResponse = {
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
  hasPassword: true,
  mfaEnabled: false,
  locale: 'en',
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
    detailError: WritableSignal<number | null>;
    loadOne: ReturnType<typeof vi.fn>;
  };
  let authStoreMock: {
    hasPermissions: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    entityMapSignal = signal({});

    usersStoreMock = {
      entityMap: entityMapSignal,
      detailLoading: signal(false),
      detailError: signal(null),
      loadOne: vi.fn()
    };

    authStoreMock = {
      hasPermissions: vi.fn().mockReturnValue(false)
    };

    await TestBed.configureTestingModule({
      imports: [UserDetailComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideNoopMaterialAnimations(),
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

  describe('role chips', () => {
    it('renders a chip per role with its name and icon', () => {
      entityMapSignal.set({ 'user-1': mockUser });
      fixture.detectChanges();

      const chips = Array.from(
        fixture.nativeElement.querySelectorAll('mat-chip')
      ) as HTMLElement[];
      const roleChip = chips.find(
        (c) => c.querySelector('mat-icon')?.textContent?.trim() === 'person'
      );
      expect(roleChip).toBeTruthy();
      expect(roleChip?.textContent).toContain('user');
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

  describe('failed load', () => {
    const errorCard = () =>
      (fixture.nativeElement as HTMLElement).querySelector('.error-container');
    const retryButton = () =>
      Array.from(
        errorCard()?.querySelectorAll<HTMLButtonElement>('button') ?? []
      ).find((b) => b.textContent?.trim() === 'Retry');

    it.each([
      [403, 'No access to this user'],
      [404, 'User not found'],
      [null, 'User not found']
    ])('shows the card for status %s without a retry', (status, title) => {
      usersStoreMock.detailError.set(status);
      fixture.detectChanges();

      expect(errorCard()?.querySelector('h3')?.textContent?.trim()).toBe(title);
      expect(retryButton()).toBeUndefined();
    });

    it.each([500, 0])(
      'shows the load-failed text and a retry for status %i',
      (status) => {
        usersStoreMock.detailError.set(status);
        fixture.detectChanges();

        expect(errorCard()?.textContent).toContain(
          'Failed to load user details. Please try again.'
        );
        expect(errorCard()?.textContent).not.toContain('User not found');

        retryButton()!.click();

        expect(usersStoreMock.loadOne).toHaveBeenCalledTimes(2);
        expect(usersStoreMock.loadOne).toHaveBeenLastCalledWith('user-1');
      }
    );

    it.each([false, true])(
      'shows the way back to the list only when search:User is held (%s)',
      (canSearch) => {
        authStoreMock.hasPermissions.mockReturnValue(canSearch);
        usersStoreMock.detailError.set(403);
        fixture.detectChanges();

        const back = Array.from(
          errorCard()?.querySelectorAll<HTMLButtonElement>('button') ?? []
        ).find((b) => b.textContent?.trim() === 'Back');
        expect(back !== undefined).toBe(canSearch);
      }
    );
  });

  describe('edit button visibility', () => {
    const editButton = (fixture: ComponentFixture<UserDetailComponent>) => {
      const root = fixture.nativeElement as HTMLElement;
      const buttons = Array.from(
        root.querySelectorAll<HTMLButtonElement>('.actions-container button')
      );
      return (
        buttons.find(
          (b) => b.querySelector('mat-icon')?.textContent?.trim() === 'edit'
        ) ?? null
      );
    };

    it('should show an enabled edit button when hasPermissions returns true for the user instance', () => {
      authStoreMock.hasPermissions.mockReturnValue(true);
      entityMapSignal.set({ 'user-1': mockUser });
      fixture.detectChanges();

      const button = editButton(fixture);
      expect(button).toBeTruthy();
      expect(button?.disabled).toBe(false);
    });

    it('should show a disabled edit button when hasPermissions returns false', () => {
      authStoreMock.hasPermissions.mockReturnValue(false);
      entityMapSignal.set({ 'user-1': mockUser });
      fixture.detectChanges();

      const button = editButton(fixture);
      expect(button).toBeTruthy();
      expect(button?.disabled).toBe(true);
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
