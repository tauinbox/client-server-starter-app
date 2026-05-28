import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { ComponentRef } from '@angular/core';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';

import { UserCardListComponent } from './user-card-list.component';
import { AuthStore } from '../../../auth/store/auth.store';
import type { User } from '../../models/user.types';
import type { RoleAdminResponse } from '@app/shared/types';
import { SYSTEM_ROLES } from '@app/shared/constants';

const userRole: RoleAdminResponse = {
  id: 'role-user',
  name: SYSTEM_ROLES.USER,
  description: 'Regular user',
  isSystem: true,
  isSuper: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

const adminRole: RoleAdminResponse = {
  id: 'role-admin',
  name: SYSTEM_ROLES.ADMIN,
  description: 'Administrator',
  isSystem: true,
  isSuper: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

const mockUser: User = {
  id: 'test-user-id',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  roles: [userRole],
  isActive: true,
  isEmailVerified: true,
  locale: 'en',
  lockedUntil: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  deletedAt: null
};

const adminUser: User = {
  ...mockUser,
  id: 'admin-user-id',
  email: 'admin@example.com',
  firstName: 'Admin',
  lastName: 'Person',
  roles: [adminRole]
};

describe('UserCardListComponent', () => {
  let component: UserCardListComponent;
  let componentRef: ComponentRef<UserCardListComponent>;
  let fixture: ComponentFixture<UserCardListComponent>;
  let authStoreMock: {
    hasPermissions: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authStoreMock = {
      hasPermissions: vi.fn().mockReturnValue(false)
    };

    await TestBed.configureTestingModule({
      imports: [UserCardListComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AuthStore, useValue: authStoreMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UserCardListComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;

    componentRef.setInput('users', []);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('trackById', () => {
    it('should return user id', () => {
      expect(component.trackById(0, mockUser)).toBe('test-user-id');
    });
  });

  describe('role chips', () => {
    it('renders the admin role with its name and icon, highlighted', () => {
      componentRef.setInput('users', [adminUser]);
      fixture.detectChanges();

      const chip = fixture.nativeElement.querySelector('.role-chips mat-chip');
      expect(chip.querySelector('mat-icon')?.textContent?.trim()).toBe(
        'admin_panel_settings'
      );
      expect(chip.textContent).toContain(SYSTEM_ROLES.ADMIN);
      expect(chip.classList.contains('mat-mdc-chip-highlighted')).toBe(true);
    });

    it('renders every role as a chip, admin first', () => {
      const multi: User = {
        ...mockUser,
        id: 'multi',
        roles: [userRole, adminRole]
      };
      componentRef.setInput('users', [multi]);
      fixture.detectChanges();

      const chips = fixture.nativeElement.querySelectorAll(
        '.role-chips mat-chip'
      );
      expect(chips.length).toBe(2);
      expect(chips[0].textContent).toContain(SYSTEM_ROLES.ADMIN);
      expect(chips[1].textContent).toContain(SYSTEM_ROLES.USER);
    });
  });

  describe('rendering', () => {
    it('should render one mat-card per user', () => {
      componentRef.setInput('users', [mockUser, adminUser]);
      fixture.detectChanges();

      const cards =
        fixture.nativeElement.querySelectorAll('mat-card.user-card');
      expect(cards.length).toBe(2);
    });

    it('should render nothing when users list is empty', () => {
      componentRef.setInput('users', []);
      fixture.detectChanges();

      const cards =
        fixture.nativeElement.querySelectorAll('mat-card.user-card');
      expect(cards.length).toBe(0);
    });

    it('should render the user full name and email', () => {
      componentRef.setInput('users', [mockUser]);
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Test User');
      expect(text).toContain('test@example.com');
    });
  });

  describe('outputs', () => {
    it('should have deleteUser output', () => {
      expect(component.deleteUser).toBeDefined();
    });
  });
});
