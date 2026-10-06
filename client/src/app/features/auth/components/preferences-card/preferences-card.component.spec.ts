import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopMaterialAnimations } from '../../../../../test-utils/material-animations';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import type { RoleResponse, UserResponse } from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { NotifyService } from '@core/services/notify.service';
import { LanguageService } from '@core/services/language.service';
import { DisplayPreferencesService } from '@core/services/display-preferences.service';
import { AuthService } from '../../services/auth.service';
import { PreferencesCardComponent } from './preferences-card.component';

const mockRole: RoleResponse = {
  id: 'role-user',
  name: 'user',
  description: 'Regular user',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

function buildUser(overrides: Partial<UserResponse> = {}): UserResponse {
  return {
    id: '1',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    isActive: true,
    roles: [mockRole],
    isEmailVerified: true,
    hasPassword: true,
    mfaEnabled: false,
    locale: 'en',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides
  };
}

describe('PreferencesCardComponent', () => {
  let component: PreferencesCardComponent;
  let fixture: ComponentFixture<PreferencesCardComponent>;
  let authServiceMock: { updateProfile: ReturnType<typeof vi.fn> };
  let notifyMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let languageServiceMock: { setLanguage: ReturnType<typeof vi.fn> };
  let displayPreferencesMock: {
    density: ReturnType<typeof signal<number>>;
    setDensity: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authServiceMock = {
      updateProfile: vi.fn().mockReturnValue(of(buildUser({ locale: 'ru' })))
    };
    notifyMock = { success: vi.fn(), error: vi.fn() };
    languageServiceMock = { setLanguage: vi.fn().mockResolvedValue(undefined) };
    displayPreferencesMock = { density: signal(0), setDensity: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [PreferencesCardComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopMaterialAnimations(),
        { provide: AuthService, useValue: authServiceMock },
        { provide: NotifyService, useValue: notifyMock },
        { provide: LanguageService, useValue: languageServiceMock },
        { provide: DisplayPreferencesService, useValue: displayPreferencesMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(PreferencesCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('user', buildUser());
    fixture.detectChanges();
  });

  it('shows the locale stored on the account', () => {
    fixture.componentRef.setInput('user', buildUser({ locale: 'ru' }));

    expect(component['locale']()).toBe('ru');
  });

  it('saves a new locale, switches the UI language and hands back the user', () => {
    const updates: UserResponse[] = [];
    component.userUpdated.subscribe((user) => updates.push(user));

    component.onLocaleChange('ru');

    expect(authServiceMock.updateProfile).toHaveBeenCalledWith({
      locale: 'ru'
    });
    expect(languageServiceMock.setLanguage).toHaveBeenCalledWith('ru');
    expect(updates).toEqual([buildUser({ locale: 'ru' })]);
    expect(notifyMock.success).toHaveBeenCalledWith(
      'auth.profile.languageUpdated'
    );
    expect(component['savingLocale']()).toBe(false);
  });

  it('sends nothing when the locale does not change', () => {
    component.onLocaleChange('en');

    expect(authServiceMock.updateProfile).not.toHaveBeenCalled();
  });

  it('puts the previous locale back when the save fails', () => {
    const httpError = new HttpErrorResponse({ status: 500 });
    authServiceMock.updateProfile.mockReturnValue(throwError(() => httpError));

    component.onLocaleChange('ru');

    expect(component['locale']()).toBe('en');
    expect(languageServiceMock.setLanguage).not.toHaveBeenCalled();
    expect(notifyMock.error).toHaveBeenCalledWith(
      httpError,
      'auth.profile.errorUpdateFailed'
    );
  });

  it('passes a density change to the display preferences', () => {
    component.onDensityChange(3);

    expect(displayPreferencesMock.setDensity).toHaveBeenCalledWith(3);
  });
});
