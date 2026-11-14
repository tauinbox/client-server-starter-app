import { ApplicationRef } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { LEGAL_DOCUMENTS } from '@app/shared/constants';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import type { LegalDocumentContent } from '../../models/legal-document';
import { LEGAL_DRAFTS_VISIBLE } from '../../services/legal-jurisdiction.service';
import { LegalDocumentComponent } from './legal-document.component';

const CONTENT: LegalDocumentContent = {
  title: 'Terms and conditions',
  updatedAt: '2026-11-14',
  sections: [
    { heading: '1. Who we are', paragraphs: ['First.', 'Second.'] },
    { heading: '2. Payment', paragraphs: ['<b>not markup</b>'] }
  ]
};

describe('LegalDocumentComponent', () => {
  let fixture: ComponentFixture<LegalDocumentComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LegalDocumentComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: LEGAL_DRAFTS_VISIBLE, useValue: true }
      ]
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LegalDocumentComponent);
    fixture.componentRef.setInput('jurisdiction', 'intl');
    fixture.componentRef.setInput('kind', 'terms');
  });

  afterEach(() => http.verify());

  async function flush(
    body: LegalDocumentContent | null
  ): Promise<HTMLElement> {
    fixture.detectChanges();
    const req = http.expectOne('assets/legal/intl/terms.en.json');

    if (body) {
      req.flush(body);
    } else {
      req.flush('missing', { status: 404, statusText: 'Not Found' });
    }

    await TestBed.inject(ApplicationRef).whenStable();
    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  }

  it('renders the title and every section with its paragraphs', async () => {
    const el = await flush(CONTENT);

    expect(el.querySelector('h1')?.textContent).toBe('Terms and conditions');
    expect(
      [...el.querySelectorAll('section h2')].map((h) => h.textContent)
    ).toEqual(['1. Who we are', '2. Payment']);
    expect(
      [...el.querySelectorAll('section p')].map((p) => p.textContent)
    ).toEqual(['First.', 'Second.', '<b>not markup</b>']);
  });

  it('renders a paragraph as text, never as markup', async () => {
    const el = await flush(CONTENT);

    expect(el.querySelector('section b')).toBeNull();
  });

  it('marks a draft version', async () => {
    expect(LEGAL_DOCUMENTS.intl.terms.status).toBe('draft');

    const el = await flush(CONTENT);

    expect(el.querySelector('.legal-draft')?.textContent).toContain('Draft.');
  });

  it('shows a message when the document does not load', async () => {
    const el = await flush(null);

    expect(el.querySelector('.legal-error')?.textContent?.trim()).toBe(
      'The document could not be loaded.'
    );
    expect(el.querySelector('h1')).toBeNull();
  });

  it('offers the other jurisdiction of the same kind', async () => {
    const el = await flush(CONTENT);
    const links = [...el.querySelectorAll('.legal-switch a')];

    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/legal/ru/terms',
      '/legal/intl/terms'
    ]);
    expect(links[1].getAttribute('aria-current')).toBe('page');
  });
});
