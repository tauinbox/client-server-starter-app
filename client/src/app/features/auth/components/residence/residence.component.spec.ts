import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router
} from '@angular/router';
import { of, throwError } from 'rxjs';
import { ErrorKeys } from '@app/shared/constants';
import { REGION_CONFIG_API_V1 } from '@core/services/region-config.service';
import { provideNoopMaterialAnimations } from '../../../../../test-utils/material-animations';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { AuthService } from '../../services/auth.service';
import { ResidenceComponent } from './residence.component';

function refusal(errorKey: string, status = 409): HttpErrorResponse {
  return new HttpErrorResponse({
    error: { message: 'Refused', errorKey },
    status
  });
}

describe('ResidenceComponent', () => {
  let component: ResidenceComponent;
  let fixture: ComponentFixture<ResidenceComponent>;
  let authServiceMock: {
    declareResidence: ReturnType<typeof vi.fn>;
    getProfile: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
  };
  let httpTesting: HttpTestingController;
  let navigateByUrl: ReturnType<typeof vi.spyOn>;

  async function setUp(returnUrl: string | null): Promise<void> {
    authServiceMock = {
      declareResidence: vi.fn(),
      getProfile: vi.fn(),
      logout: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [ResidenceComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopMaterialAnimations(),
        { provide: AuthService, useValue: authServiceMock },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap(returnUrl ? { returnUrl } : {})
            }
          }
        }
      ]
    }).compileComponents();

    navigateByUrl = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
    fixture = TestBed.createComponent(ResidenceComponent);
    component = fixture.componentInstance;
    httpTesting = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  }

  afterEach(() => httpTesting.verify());

  async function submit(country: 'DE' | 'RU' | ''): Promise<void> {
    component.residenceModel.set({ residenceCountry: country });
    await fixture.whenStable();
    component.onSubmit();
    fixture.detectChanges();
  }

  it('sends nothing until a country is chosen', async () => {
    await setUp('/billing');
    await submit('');

    expect(authServiceMock.declareResidence).not.toHaveBeenCalled();
  });

  it('declares the country and goes on to the page the account asked for', async () => {
    await setUp('/billing?tab=plans');
    authServiceMock.declareResidence.mockReturnValue(of({}));

    await submit('DE');

    expect(authServiceMock.declareResidence).toHaveBeenCalledWith('DE');
    expect(navigateByUrl).toHaveBeenCalledWith('/billing?tab=plans');
  });

  it('goes to the root for a target on another origin', async () => {
    await setUp('https://evil.example/x');
    authServiceMock.declareResidence.mockReturnValue(of({}));

    await submit('DE');

    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('stays on the page for a region with no site, so the owner can choose again', async () => {
    await setUp('/billing');
    authServiceMock.declareResidence.mockReturnValue(
      throwError(() => refusal(ErrorKeys.AUTH.RESIDENCE_REGION_NOT_SERVED))
    );

    await submit('RU');

    expect(component['error']()).toBe(
      'Accounts for this country are not available yet.'
    );
    expect(component['peerUrl']()).toBeNull();
    expect(component['loading']()).toBe(false);
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('links to the site of another region', async () => {
    await setUp('/billing');
    authServiceMock.declareResidence.mockReturnValue(
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
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('goes on when another tab declared the country first', async () => {
    await setUp('/profile');
    authServiceMock.declareResidence.mockReturnValue(
      throwError(() => refusal(ErrorKeys.AUTH.RESIDENCE_ALREADY_DECLARED))
    );
    authServiceMock.getProfile.mockReturnValue(of({}));

    await submit('DE');

    expect(authServiceMock.getProfile).toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith('/profile');
  });

  it('shows the fallback text for an answer with no key', async () => {
    await setUp('/billing');
    authServiceMock.declareResidence.mockReturnValue(
      throwError(() => new HttpErrorResponse({ error: null, status: 500 }))
    );

    await submit('DE');

    expect(component['error']()).toBe(
      'The country of residence could not be saved. Please try again.'
    );
  });

  it('signs out', async () => {
    await setUp(null);

    component.onSignOut();

    expect(authServiceMock.logout).toHaveBeenCalledWith();
  });
});
