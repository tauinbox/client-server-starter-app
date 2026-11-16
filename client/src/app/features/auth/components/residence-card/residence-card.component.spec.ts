import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { ErrorKeys } from '@app/shared/constants';
import type { UserResponse } from '@app/shared/types';
import { NotifyService } from '@core/services/notify.service';
import { RegionConfigService } from '@core/services/region-config.service';
import { provideNoopMaterialAnimations } from '../../../../../test-utils/material-animations';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { AuthService } from '../../services/auth.service';
import { ResidenceCardComponent } from './residence-card.component';

const USER: UserResponse = {
  id: 'user-1',
  email: 'owner@example.com',
  name: 'Owner',
  isActive: true,
  roles: [],
  isEmailVerified: true,
  hasPassword: true,
  mfaEnabled: false,
  residenceCountry: 'DE',
  locale: 'en',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  deletedAt: null
};

describe('ResidenceCardComponent', () => {
  let fixture: ComponentFixture<ResidenceCardComponent>;
  let component: ResidenceCardComponent;
  let authServiceMock: { changeResidence: ReturnType<typeof vi.fn> };
  let regionConfigMock: { peerUrl: ReturnType<typeof vi.fn> };
  let notifyMock: { success: ReturnType<typeof vi.fn> };

  async function setUp(inputs: {
    user?: UserResponse;
    canChange?: boolean;
    reauthProviderLabel?: string;
  }): Promise<void> {
    authServiceMock = { changeResidence: vi.fn() };
    regionConfigMock = { peerUrl: vi.fn().mockReturnValue(of(null)) };
    notifyMock = { success: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [ResidenceCardComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopMaterialAnimations(),
        { provide: AuthService, useValue: authServiceMock },
        { provide: RegionConfigService, useValue: regionConfigMock },
        { provide: NotifyService, useValue: notifyMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ResidenceCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('user', inputs.user ?? USER);
    fixture.componentRef.setInput('canChange', inputs.canChange ?? true);
    fixture.componentRef.setInput(
      'reauthProviderLabel',
      inputs.reauthProviderLabel ?? ''
    );
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  const button = (label: string) =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === label
    );

  async function chooseAndSave(
    country: 'FR' | 'RU',
    typeFactor?: () => void
  ): Promise<void> {
    component.startChange();
    component.countryModel.set({ residenceCountry: country });
    typeFactor?.();
    fixture.detectChanges();
    await fixture.whenStable();
    component.save();
    fixture.detectChanges();
  }

  it('names the declared country', async () => {
    await setUp({});

    expect(text()).toContain('Germany');
  });

  it('says a country is not set', async () => {
    await setUp({ user: { ...USER, residenceCountry: null } });

    expect(text()).toContain('Not set');
  });

  it('offers no change to a role that may not edit its profile', async () => {
    await setUp({ canChange: false });

    expect(button('Change')).toBeUndefined();
  });

  it('sends nothing until the current password is typed', async () => {
    await setUp({});
    await chooseAndSave('FR');

    expect(authServiceMock.changeResidence).not.toHaveBeenCalled();
  });

  it('changes the country with the current password and reports the new user', async () => {
    await setUp({});

    const changed = { ...USER, residenceCountry: 'FR' as const };
    const updated = vi.fn();

    component.userUpdated.subscribe(updated);
    authServiceMock.changeResidence.mockReturnValue(of(changed));
    await chooseAndSave('FR', () =>
      component.passwordModel.set({ currentPassword: 'Lantern-Orchard-47' })
    );

    expect(authServiceMock.changeResidence).toHaveBeenCalledWith('FR', {
      currentPassword: 'Lantern-Orchard-47'
    });
    expect(updated).toHaveBeenCalledWith(changed);
    expect(notifyMock.success).toHaveBeenCalledWith(
      'auth.residenceCard.successChanged'
    );
  });

  it('sends a code for an account with no password and an authenticator', async () => {
    await setUp({ user: { ...USER, hasPassword: false, mfaEnabled: true } });
    authServiceMock.changeResidence.mockReturnValue(of(USER));
    await chooseAndSave('FR', () =>
      component.codeModel.set({ code: '123456' })
    );

    expect(authServiceMock.changeResidence).toHaveBeenCalledWith('FR', {
      code: '123456'
    });
  });

  it('asks the page for a provider round trip and sends nothing itself', async () => {
    await setUp({
      user: { ...USER, hasPassword: false, mfaEnabled: false },
      reauthProviderLabel: 'Google'
    });

    const requested = vi.fn();

    component.reauthRequested.subscribe(requested);
    await chooseAndSave('FR');

    expect(requested).toHaveBeenCalledWith('FR');
    expect(authServiceMock.changeResidence).not.toHaveBeenCalled();
  });

  it('sends one change on the load after the round trip', async () => {
    await setUp({ user: { ...USER, hasPassword: false, mfaEnabled: false } });
    authServiceMock.changeResidence.mockReturnValue(of(USER));

    fixture.componentRef.setInput('resumeChange', 'FR');
    fixture.detectChanges();
    fixture.componentRef.setInput('resumeChange', 'IT');
    fixture.detectChanges();

    expect(authServiceMock.changeResidence).toHaveBeenCalledTimes(1);
    expect(authServiceMock.changeResidence).toHaveBeenCalledWith('FR', {});
  });

  it('keeps the form open with the refusal and asks for the peer link', async () => {
    await setUp({});
    authServiceMock.changeResidence.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              message: 'Refused',
              errorKey: ErrorKeys.AUTH.RESIDENCE_REGION_NOT_SERVED
            }
          })
      )
    );
    await chooseAndSave('RU', () =>
      component.passwordModel.set({ currentPassword: 'Lantern-Orchard-47' })
    );

    expect(component['error']()).toBe(
      'Accounts for this country are not available yet.'
    );
    expect(component['editing']()).toBe(true);
    expect(regionConfigMock.peerUrl).toHaveBeenCalledWith(
      'RU',
      ErrorKeys.AUTH.RESIDENCE_REGION_NOT_SERVED
    );
  });
});
