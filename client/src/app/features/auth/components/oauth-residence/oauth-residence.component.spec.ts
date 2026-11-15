import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ErrorKeys, OAUTH_ERROR, type OAuthError } from '@app/shared/constants';
import { REGION_CONFIG_API_V1 } from '@core/services/region-config.service';
import { provideNoopMaterialAnimations } from '../../../../../test-utils/material-animations';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { AuthService } from '../../services/auth.service';
import { presetResidenceCountry } from '../../utils/residence-country';
import { OAuthResidenceComponent } from './oauth-residence.component';

function refusal(errorKey: string, status = 409): HttpErrorResponse {
  return new HttpErrorResponse({
    error: { message: 'Refused', errorKey },
    status
  });
}

describe('OAuthResidenceComponent', () => {
  let component: OAuthResidenceComponent;
  let fixture: ComponentFixture<OAuthResidenceComponent>;
  let authServiceMock: { completeOAuthSignup: ReturnType<typeof vi.fn> };
  let httpTesting: HttpTestingController;
  let completed: ReturnType<typeof vi.fn<() => void>>;
  let cancelled: ReturnType<typeof vi.fn<() => void>>;
  let failed: ReturnType<typeof vi.fn<(error: OAuthError) => void>>;

  beforeEach(async () => {
    authServiceMock = { completeOAuthSignup: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [OAuthResidenceComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopMaterialAnimations(),
        { provide: AuthService, useValue: authServiceMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(OAuthResidenceComponent);
    component = fixture.componentInstance;
    httpTesting = TestBed.inject(HttpTestingController);
    completed = vi.fn();
    cancelled = vi.fn();
    failed = vi.fn();
    component.completed.subscribe(completed);
    component.cancelled.subscribe(cancelled);
    component.failed.subscribe(failed);
    fixture.detectChanges();
  });

  afterEach(() => httpTesting.verify());

  async function submit(country: 'DE' | 'RU' | ''): Promise<void> {
    component.residenceModel.set({ residenceCountry: country });
    await fixture.whenStable();
    component.onSubmit();
    fixture.detectChanges();
  }

  it('presets the country from the browser languages', () => {
    expect(component.residenceModel().residenceCountry).toBe(
      presetResidenceCountry(navigator.languages)
    );
  });

  it('sends nothing until a country is chosen', async () => {
    await submit('');

    expect(authServiceMock.completeOAuthSignup).not.toHaveBeenCalled();
  });

  it('creates the account with the declared country and reports it', async () => {
    authServiceMock.completeOAuthSignup.mockReturnValue(of({}));

    await submit('DE');

    expect(authServiceMock.completeOAuthSignup).toHaveBeenCalledWith('DE');
    expect(completed).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it('says a region with no site is not served, and stays for another country', async () => {
    authServiceMock.completeOAuthSignup.mockReturnValue(
      throwError(() => refusal(ErrorKeys.AUTH.RESIDENCE_REGION_NOT_SERVED))
    );

    await submit('RU');

    expect(component['error']()).toBe(
      'Registration for this country is not available yet.'
    );
    expect(component['peerUrl']()).toBeNull();
    expect(failed).not.toHaveBeenCalled();
    expect(component['loading']()).toBe(false);
  });

  it('links to the site of another region', async () => {
    authServiceMock.completeOAuthSignup.mockReturnValue(
      throwError(() => refusal(ErrorKeys.AUTH.RESIDENCE_OTHER_REGION))
    );

    await submit('RU');
    httpTesting
      .expectOne(REGION_CONFIG_API_V1)
      .flush({ region: 'intl', peers: { ru: 'https://ru.example.com' } });
    fixture.detectChanges();

    const link: HTMLAnchorElement =
      fixture.nativeElement.querySelector('.peer-region-link');

    expect(link.getAttribute('href')).toBe('https://ru.example.com');
    expect(failed).not.toHaveBeenCalled();
  });

  // The sign-up cannot go on: the cookie is gone, or the address belongs to
  // an account now. The sign-in restarts on /login with its reason.
  it.each([
    [ErrorKeys.AUTH.MISSING_OAUTH_DATA, 401, OAUTH_ERROR.AUTH_FAILED],
    [ErrorKeys.AUTH.INVALID_OAUTH_DATA, 401, OAUTH_ERROR.AUTH_FAILED],
    [ErrorKeys.USERS.EMAIL_EXISTS, 409, OAUTH_ERROR.EMAIL_ALREADY_REGISTERED]
  ])('restarts at /login on %s', async (errorKey, status, reason) => {
    authServiceMock.completeOAuthSignup.mockReturnValue(
      throwError(() => refusal(errorKey, status))
    );

    await submit('DE');

    expect(failed).toHaveBeenCalledWith(reason);
    expect(component['error']()).toBeNull();
  });

  it('shows the fallback text for an answer with no key', async () => {
    authServiceMock.completeOAuthSignup.mockReturnValue(
      throwError(() => new HttpErrorResponse({ error: null, status: 500 }))
    );

    await submit('DE');

    expect(component['error']()).toBe(
      'The account could not be created. Please try again.'
    );
    expect(failed).not.toHaveBeenCalled();
  });

  it('reports a cancel', () => {
    const cancel: HTMLButtonElement = fixture.nativeElement.querySelector(
      '.residence-links button'
    );

    cancel.click();

    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
