import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopMaterialAnimations } from '../../../../../test-utils/material-animations';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import {
  ErrorKeys,
  HOME_DATA_REGION,
  type DataRegion
} from '@app/shared/constants';

import { RegisterComponent } from './register.component';
import { AuthService } from '../../services/auth.service';
import { presetResidenceCountry } from '../../utils/residence-country';
import { REGION_CONFIG_API_V1 } from '@core/services/region-config.service';

const mockRegisterResponse = {
  message:
    'Registration successful. Please check your email to verify your account.'
};

describe('RegisterComponent', () => {
  let component: RegisterComponent;
  let fixture: ComponentFixture<RegisterComponent>;
  let authServiceMock: { register: ReturnType<typeof vi.fn> };
  let router: Router;
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    authServiceMock = { register: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [RegisterComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopMaterialAnimations(),
        { provide: AuthService, useValue: authServiceMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    httpTesting = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => httpTesting.verify());

  /** Answers the registry read that a country of a non-home region makes first. */
  function flushPublicRegions(publicRegions: DataRegion[]): void {
    httpTesting
      .expectOne(REGION_CONFIG_API_V1)
      .flush({ region: 'intl', peers: {}, publicRegions });
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('marks the password field as a new password for password managers', () => {
    const input: HTMLInputElement = fixture.nativeElement.querySelector(
      'input[type="password"]'
    );

    expect(input.getAttribute('autocomplete')).toBe('new-password');
  });

  describe('form validation', () => {
    it('should be invalid when empty', () => {
      expect(component.registerForm().valid()).toBe(false);
    });

    it('accepts 64 Cyrillic characters, which are 128 bytes', async () => {
      component.registerModel.set({
        residenceCountry: 'DE',
        email: 'user@example.com',
        name: 'Test User',
        password: 'Пароль1' + 'я'.repeat(57)
      });
      await fixture.whenStable();

      expect(component.registerForm.password().errors()).toEqual([]);
    });

    it('rejects 129 characters on the length cap', async () => {
      component.registerModel.set({
        residenceCountry: 'DE',
        email: 'user@example.com',
        name: 'Test User',
        password: 'A1' + 'a'.repeat(127)
      });
      await fixture.whenStable();

      expect(
        component.registerForm
          .password()
          .errors()
          .some(
            (e) =>
              e.kind === 'maxLength' &&
              e.message === 'auth.register.passwordMaxLength'
          )
      ).toBe(true);
    });

    it('should require email', () => {
      const emailErrors = component.registerForm.email().errors();

      expect(emailErrors.some((e) => e.kind === 'required')).toBe(true);
    });

    it('should validate email format', async () => {
      component.registerModel.set({
        residenceCountry: 'DE',
        email: 'invalid',
        name: '',
        password: ''
      });
      await fixture.whenStable();
      const emailErrors = component.registerForm.email().errors();

      expect(emailErrors.some((e) => e.kind === 'email')).toBe(true);

      component.registerModel.set({
        residenceCountry: 'DE',
        email: 'test@example.com',
        name: '',
        password: ''
      });
      await fixture.whenStable();
      expect(component.registerForm.email().valid()).toBe(true);
    });

    it('should require name', () => {
      const errors = component.registerForm.name().errors();

      expect(errors.some((e) => e.kind === 'required')).toBe(true);
    });

    it('should refuse a name of spaces only', async () => {
      component.registerModel.update((m) => ({ ...m, name: '   ' }));
      await fixture.whenStable();
      const errors = component.registerForm.name().errors();

      expect(errors.map((e) => [e.kind, e.message])).toContainEqual([
        'required',
        'auth.register.nameRequired'
      ]);
    });

    it('should require password', () => {
      const errors = component.registerForm.password().errors();

      expect(errors.some((e) => e.kind === 'required')).toBe(true);
    });

    it('should enforce password minLength of 8', async () => {
      component.registerModel.set({
        residenceCountry: 'DE',
        email: 'test@example.com',
        name: 'Test User',
        password: 'short'
      });
      await fixture.whenStable();
      const errors = component.registerForm.password().errors();

      expect(errors.some((e) => e.kind === 'minLength')).toBe(true);

      component.registerModel.set({
        residenceCountry: 'DE',
        email: 'test@example.com',
        name: 'Test User',
        password: 'LongPassword1'
      });
      await fixture.whenStable();
      expect(component.registerForm.password().valid()).toBe(true);
    });

    it('accepts a password made only of lower-case letters', async () => {
      component.registerModel.set({
        residenceCountry: 'DE',
        email: 'test@example.com',
        name: 'Test User',
        password: 'passwordonly'
      });
      await fixture.whenStable();

      expect(component.registerForm.password().errors()).toEqual([]);
      expect(component.registerForm.password().valid()).toBe(true);
    });

    it('rejects a password longer than the server ceiling', async () => {
      component.registerModel.set({
        residenceCountry: 'DE',
        email: 'test@example.com',
        name: 'Test User',
        password: `Aa1${'x'.repeat(126)}`
      });
      await fixture.whenStable();

      const errors = component.registerForm.password().errors();

      expect(errors.some((e) => e.kind === 'maxLength')).toBe(true);
      expect(errors.find((e) => e.kind === 'maxLength')?.message).toBe(
        'auth.register.passwordMaxLength'
      );
    });

    it('should require a country of residence', async () => {
      component.registerModel.update((m) => ({ ...m, residenceCountry: '' }));
      await fixture.whenStable();

      expect(
        component.registerForm
          .residenceCountry()
          .errors()
          .map((e) => [e.kind, e.message])
      ).toEqual([['required', 'auth.register.residenceCountryRequired']]);
    });

    it('presets the country from the region of the browser language', () => {
      expect(component.registerModel().residenceCountry).toBe(
        presetResidenceCountry(navigator.languages)
      );
    });

    it('should be valid with correct values', async () => {
      component.registerModel.set({
        residenceCountry: 'DE',
        email: 'test@example.com',
        name: 'Test User',
        password: 'Password123'
      });
      await fixture.whenStable();
      expect(component.registerForm().valid()).toBe(true);
    });
  });

  describe('onSubmit', () => {
    const validForm = {
      email: 'test@example.com',
      name: 'Test User',
      password: 'Password123',
      residenceCountry: 'DE' as const
    };

    it('should not call register when form is invalid', () => {
      component.onSubmit();
      expect(authServiceMock.register).not.toHaveBeenCalled();
    });

    it('should call register with form values', async () => {
      authServiceMock.register.mockReturnValue(of(mockRegisterResponse));
      vi.spyOn(router, 'navigate');

      component.registerModel.set(validForm);
      await fixture.whenStable();
      component.onSubmit();

      expect(authServiceMock.register).toHaveBeenCalledWith(validForm, {
        captchaToken: null,
        region: HOME_DATA_REGION
      });
    });

    it('registers in the pool of the region of the country while it is public', async () => {
      authServiceMock.register.mockReturnValue(of(mockRegisterResponse));
      vi.spyOn(router, 'navigate');

      component.registerModel.set({ ...validForm, residenceCountry: 'RU' });
      await fixture.whenStable();
      component.onSubmit();
      flushPublicRegions(['intl', 'ru']);

      expect(authServiceMock.register).toHaveBeenCalledWith(
        { ...validForm, residenceCountry: 'RU' },
        { captchaToken: null, region: 'ru' }
      );
    });

    it('should navigate to login with pending-verification on success', async () => {
      authServiceMock.register.mockReturnValue(of(mockRegisterResponse));
      vi.spyOn(router, 'navigate');

      component.registerModel.set(validForm);
      await fixture.whenStable();
      component.onSubmit();

      expect(router.navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: { registered: 'pending-verification' }
      });
      expect(component['loading']()).toBe(false);
    });

    it('should show "email exists" error on a taken address', async () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Conflict', errorKey: ErrorKeys.USERS.EMAIL_EXISTS },
        status: 409
      });

      authServiceMock.register.mockReturnValue(throwError(() => httpError));

      component.registerModel.set(validForm);
      await fixture.whenStable();
      component.onSubmit();

      expect(component['error']()).toBe('User with this email already exists.');
      expect(component['loading']()).toBe(false);
    });

    it('says a region with no site is not served, with no link', async () => {
      authServiceMock.register.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              error: {
                message: 'Not served',
                errorKey: ErrorKeys.AUTH.RESIDENCE_REGION_NOT_SERVED
              },
              status: 409
            })
        )
      );

      component.registerModel.set({ ...validForm, residenceCountry: 'RU' });
      await fixture.whenStable();
      component.onSubmit();
      flushPublicRegions(['intl']);

      expect(authServiceMock.register).toHaveBeenCalledWith(
        { ...validForm, residenceCountry: 'RU' },
        { captchaToken: null, region: HOME_DATA_REGION }
      );
      expect(component['error']()).toBe(
        'Accounts for this country are not available yet.'
      );
      expect(component['peerUrl']()).toBeNull();
    });

    describe('a country of another region', () => {
      const otherRegion = new HttpErrorResponse({
        error: {
          message: 'Other region',
          errorKey: ErrorKeys.AUTH.RESIDENCE_OTHER_REGION
        },
        status: 409
      });

      async function submitAs(peers: Record<string, string>): Promise<void> {
        authServiceMock.register.mockReturnValue(throwError(() => otherRegion));
        component.registerModel.set({ ...validForm, residenceCountry: 'RU' });
        await fixture.whenStable();
        component.onSubmit();
        flushPublicRegions(['intl']);
        httpTesting
          .expectOne(REGION_CONFIG_API_V1)
          .flush({ region: 'intl', peers, publicRegions: ['intl'] });
        fixture.detectChanges();
      }

      it('links to the site of that region', async () => {
        await submitAs({ ru: 'https://ru.example.com' });

        expect(component['error']()).toBe(
          'Accounts for this country are kept on another site.'
        );

        const link: HTMLAnchorElement =
          fixture.nativeElement.querySelector('.peer-region-link');

        expect(link.getAttribute('href')).toBe('https://ru.example.com');
        expect(link.textContent?.trim()).toBe(
          'Go to the site for this country'
        );
      });

      it('makes no link of a URL that is not https', async () => {
        await submitAs({ ru: 'javascript:alert(1)' });

        expect(component['peerUrl']()).toBeNull();
        expect(
          fixture.nativeElement.querySelector('.peer-region-link')
        ).toBeNull();
      });
    });

    it('should show fallback translation on non-409 error without errorKey', async () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Validation failed' },
        status: 400
      });

      authServiceMock.register.mockReturnValue(throwError(() => httpError));

      component.registerModel.set(validForm);
      await fixture.whenStable();
      component.onSubmit();

      expect(component['error']()).toBe(
        'Registration failed. Please try again.'
      );
    });

    it('should translate error from errorKey on non-409 error', async () => {
      const httpError = new HttpErrorResponse({
        error: {
          message: 'Validation failed',
          errorKey: ErrorKeys.GENERAL.INTERNAL_SERVER_ERROR
        },
        status: 500
      });

      authServiceMock.register.mockReturnValue(throwError(() => httpError));

      component.registerModel.set(validForm);
      await fixture.whenStable();
      component.onSubmit();

      expect(component['error']()).toBe('Internal server error');
    });

    it('never renders an untranslated errorKey as a dot-path', async () => {
      const httpError = new HttpErrorResponse({
        error: {
          message: 'Registration is closed for this tenant',
          // eslint-disable-next-line no-restricted-syntax -- a key the client does not know yet
          errorKey: 'errors.auth.keyAddedByTheServerFirst'
        },
        status: 400
      });

      authServiceMock.register.mockReturnValue(throwError(() => httpError));

      component.registerModel.set(validForm);
      await fixture.whenStable();
      component.onSubmit();

      expect(component['error']()).toBe(
        'Registration failed. Please try again.'
      );
    });

    it('should show fallback error message when no server message', async () => {
      const httpError = new HttpErrorResponse({
        error: null,
        status: 500
      });

      authServiceMock.register.mockReturnValue(throwError(() => httpError));

      component.registerModel.set(validForm);
      await fixture.whenStable();
      component.onSubmit();

      expect(component['error']()).toBe(
        'Registration failed. Please try again.'
      );
    });
  });

  describe('captcha soft-trigger', () => {
    const validForm = {
      email: 'test@example.com',
      name: 'Test User',
      password: 'Password123',
      residenceCountry: 'DE' as const
    };

    it('shows captcha on CAPTCHA_REQUIRED response and disables submit until token', async () => {
      const httpError = new HttpErrorResponse({
        error: {
          message: 'Captcha required',
          errorKey: ErrorKeys.AUTH.CAPTCHA_REQUIRED
        },
        status: 400
      });

      authServiceMock.register.mockReturnValueOnce(throwError(() => httpError));

      component.registerModel.set(validForm);
      await fixture.whenStable();
      component.onSubmit();

      expect(component['captchaRequired']()).toBe(true);
      expect(component['captchaToken']()).toBeNull();
      expect(component['canSubmit']()).toBe(false);
      expect(component['error']()).toBe(
        'Please complete the CAPTCHA challenge to continue.'
      );
    });

    it('passes captchaToken on retry after solving', async () => {
      const httpError = new HttpErrorResponse({
        error: {
          message: 'Captcha required',
          errorKey: ErrorKeys.AUTH.CAPTCHA_REQUIRED
        },
        status: 400
      });

      authServiceMock.register
        .mockReturnValueOnce(throwError(() => httpError))
        .mockReturnValueOnce(of(mockRegisterResponse));
      vi.spyOn(router, 'navigate');

      component.registerModel.set(validForm);
      await fixture.whenStable();
      component.onSubmit();

      // Simulate widget callback firing
      component['onCaptchaToken']('turnstile-token');
      expect(component['canSubmit']()).toBe(true);

      component.onSubmit();
      expect(authServiceMock.register).toHaveBeenLastCalledWith(validForm, {
        captchaToken: 'turnstile-token',
        region: HOME_DATA_REGION
      });
      expect(router.navigate).toHaveBeenCalled();
    });

    it('drops the token of one pool when the next attempt goes to another region', async () => {
      const httpError = new HttpErrorResponse({
        error: {
          message: 'Captcha required',
          errorKey: ErrorKeys.AUTH.CAPTCHA_REQUIRED
        },
        status: 400
      });

      authServiceMock.register
        .mockReturnValueOnce(throwError(() => httpError))
        .mockReturnValueOnce(of(mockRegisterResponse));
      vi.spyOn(router, 'navigate');

      component.registerModel.set(validForm);
      await fixture.whenStable();
      component.onSubmit();
      component['onCaptchaToken']('home-token');

      component.registerModel.set({ ...validForm, residenceCountry: 'RU' });
      await fixture.whenStable();
      component.onSubmit();
      httpTesting
        .expectOne(REGION_CONFIG_API_V1)
        .flush({ region: 'intl', peers: {}, publicRegions: ['intl', 'ru'] });

      expect(authServiceMock.register).toHaveBeenLastCalledWith(
        { ...validForm, residenceCountry: 'RU' },
        { captchaToken: null, region: 'ru' }
      );
      expect(component['captchaRequired']()).toBe(false);
      expect(component['captchaRegion']()).toBe('ru');
    });

    it('clears the token and shows the same widget when CAPTCHA_INVALID is returned', async () => {
      const invalidErr = new HttpErrorResponse({
        error: {
          message: 'Bad captcha',
          errorKey: ErrorKeys.AUTH.CAPTCHA_INVALID
        },
        status: 400
      });

      authServiceMock.register.mockReturnValue(throwError(() => invalidErr));

      component.registerModel.set(validForm);
      await fixture.whenStable();
      component['captchaRequired'].set(true);
      component['captchaToken'].set('stale-token');
      component.onSubmit();

      expect(component['captchaRequired']()).toBe(true);
      expect(component['captchaToken']()).toBeNull();
      expect(component['error']()).toBe(
        'CAPTCHA verification failed. Please try again.'
      );
    });

    it('clears stale captchaRequired error when widget emits a token', async () => {
      const httpError = new HttpErrorResponse({
        error: {
          message: 'Captcha required',
          errorKey: ErrorKeys.AUTH.CAPTCHA_REQUIRED
        },
        status: 400
      });

      authServiceMock.register.mockReturnValueOnce(throwError(() => httpError));

      component.registerModel.set(validForm);
      await fixture.whenStable();
      component.onSubmit();

      expect(component['error']()).toBe(
        'Please complete the CAPTCHA challenge to continue.'
      );

      component['onCaptchaToken']('turnstile-token');

      expect(component['error']()).toBeNull();
      expect(component['captchaToken']()).toBe('turnstile-token');
    });

    it('keeps the error when widget emits null (expiry or error callback)', async () => {
      const httpError = new HttpErrorResponse({
        error: {
          message: 'Captcha required',
          errorKey: ErrorKeys.AUTH.CAPTCHA_REQUIRED
        },
        status: 400
      });

      authServiceMock.register.mockReturnValueOnce(throwError(() => httpError));

      component.registerModel.set(validForm);
      await fixture.whenStable();
      component.onSubmit();

      component['onCaptchaToken'](null);

      expect(component['error']()).toBe(
        'Please complete the CAPTCHA challenge to continue.'
      );
      expect(component['captchaToken']()).toBeNull();
    });
  });
});
