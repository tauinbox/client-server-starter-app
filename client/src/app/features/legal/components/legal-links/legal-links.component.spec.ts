import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import type { BillingRegionResponse } from '@app/shared/types';
import { AuthStore } from '@features/auth/store/auth.store';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import {
  LEGAL_DRAFTS_VISIBLE,
  LegalJurisdictionService
} from '../../services/legal-jurisdiction.service';
import { LegalLinksComponent } from './legal-links.component';

const RU_REGION: BillingRegionResponse = {
  region: 'ru',
  detectedProvider: 'paddle',
  effectiveProvider: 'yookassa',
  availableProviders: ['yookassa', 'paddle']
};

function setup(options: { draftsVisible: boolean; authenticated?: boolean }) {
  TestBed.configureTestingModule({
    imports: [LegalLinksComponent, TranslocoTestingModuleWithLangs],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: LEGAL_DRAFTS_VISIBLE, useValue: options.draftsVisible },
      {
        provide: AuthStore,
        useValue: { isAuthenticated: signal(options.authenticated ?? false) }
      }
    ]
  });

  const fixture = TestBed.createComponent(LegalLinksComponent);

  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const hrefs = (el: HTMLElement) =>
  [...el.querySelectorAll('a')].map((a) => a.getAttribute('href'));

describe('LegalLinksComponent', () => {
  it('renders nothing while every document is a hidden draft', () => {
    const { fixture, el } = setup({ draftsVisible: false });

    fixture.detectChanges();

    expect(el.querySelector('.legal-links')).toBeNull();
    TestBed.inject(HttpTestingController).verify();
  });

  it('links an anonymous English visitor to the documents of other countries', () => {
    const { fixture, el } = setup({ draftsVisible: true });

    fixture.detectChanges();

    expect(hrefs(el)).toEqual([
      '/legal/intl/terms',
      '/legal/intl/privacy',
      '/legal/intl/refund',
      '/legal/intl/contacts'
    ]);
  });

  it('links only the requested kinds, after the intro text', () => {
    const { fixture, el } = setup({ draftsVisible: true });

    fixture.componentRef.setInput('kinds', ['terms', 'privacy']);
    fixture.componentRef.setInput('intro', 'legal.introRegister');
    fixture.componentRef.setInput('jurisdiction', 'ru');
    fixture.detectChanges();

    expect(el.querySelector('span')?.textContent).toBe(
      'Documents of the service:'
    );
    expect(hrefs(el)).toEqual(['/legal/ru/terms', '/legal/ru/privacy']);
  });

  it('follows the billing region of a signed-in user', async () => {
    const { fixture, el } = setup({ draftsVisible: true, authenticated: true });

    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/v1/billing/region')
      .flush(RU_REGION);
    await TestBed.inject(ApplicationRef).whenStable();
    fixture.detectChanges();

    expect(hrefs(el)[0]).toBe('/legal/ru/terms');
  });

  it('takes a region that the billing store reports', () => {
    const { fixture, el } = setup({ draftsVisible: true, authenticated: true });

    fixture.detectChanges();
    TestBed.inject(LegalJurisdictionService).setBillingRegion(RU_REGION);
    fixture.detectChanges();

    expect(hrefs(el)[0]).toBe('/legal/ru/terms');
  });
});
