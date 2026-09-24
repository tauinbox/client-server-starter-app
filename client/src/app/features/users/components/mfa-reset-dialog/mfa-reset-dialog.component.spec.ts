import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ErrorKeys } from '@app/shared/constants';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';

import { MfaResetDialogComponent } from './mfa-reset-dialog.component';
import type { MfaResetDialogData } from './mfa-reset-dialog.component';
import { UsersStore } from '../../store/users.store';
import { NotifyService } from '@core/services/notify.service';
import type { User } from '../../models/user.types';

const enrolledUser: User = {
  id: 'user-9',
  email: 'owner@example.com',
  firstName: 'Olga',
  lastName: 'Owner',
  roles: [],
  isActive: true,
  isEmailVerified: true,
  hasPassword: true,
  mfaEnabled: true,
  locale: 'en',
  lockedUntil: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  deletedAt: null
};

describe('MfaResetDialogComponent', () => {
  let component: MfaResetDialogComponent;
  let fixture: ComponentFixture<MfaResetDialogComponent>;
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };
  let usersStoreMock: { resetMfa: ReturnType<typeof vi.fn> };
  let notifyMock: { success: ReturnType<typeof vi.fn> };

  function createComponent(factor: MfaResetDialogData['factor']): void {
    TestBed.configureTestingModule({
      imports: [MfaResetDialogComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        { provide: MatDialogRef, useValue: dialogRefMock },
        {
          provide: MAT_DIALOG_DATA,
          useValue: { user: enrolledUser, factor } satisfies MfaResetDialogData
        },
        { provide: UsersStore, useValue: usersStoreMock },
        { provide: NotifyService, useValue: notifyMock }
      ]
    });

    fixture = TestBed.createComponent(MfaResetDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function input(selector: string): HTMLInputElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(selector);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    dialogRefMock = { close: vi.fn() };
    usersStoreMock = {
      resetMfa: vi
        .fn()
        .mockReturnValue(of({ ...enrolledUser, mfaEnabled: false }))
    };
    notifyMock = { success: vi.fn() };
  });

  it('asks for the password of the caller and sends only that', () => {
    createComponent('password');
    expect(input('input[autocomplete="current-password"]')).toBeTruthy();
    expect(component['canSubmit']()).toBe(false);

    component.passwordModel.set({ currentPassword: 'Admin-Secret-1' });
    component.submit();

    expect(usersStoreMock.resetMfa).toHaveBeenCalledWith('user-9', {
      currentPassword: 'Admin-Secret-1'
    });
    expect(notifyMock.success).toHaveBeenCalledWith(
      'users.edit.successMfaReset'
    );
    expect(dialogRefMock.close).toHaveBeenCalledWith({
      ...enrolledUser,
      mfaEnabled: false
    });
  });

  it('asks for a code when the caller holds no password', () => {
    createComponent('code');
    expect(input('input[autocomplete="one-time-code"]')).toBeTruthy();

    component.codeModel.set({ code: ' 123456 ' });
    component.submit();

    expect(usersStoreMock.resetMfa).toHaveBeenCalledWith('user-9', {
      code: '123456'
    });
  });

  it('cannot submit when the caller holds no factor at all', () => {
    createComponent('none');

    component.submit();

    expect(component['canSubmit']()).toBe(false);
    expect(usersStoreMock.resetMfa).not.toHaveBeenCalled();
  });

  it('stays open and shows the refusal of the server', () => {
    usersStoreMock.resetMfa.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              message: 'Current password is incorrect',
              errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD
            }
          })
      )
    );
    createComponent('password');

    component.passwordModel.set({ currentPassword: 'Wrong-1' });
    component.submit();

    expect(dialogRefMock.close).not.toHaveBeenCalled();
    expect(component['errorMessage']()).toBeTruthy();
    expect(component['isLoading']()).toBe(false);
  });
});
