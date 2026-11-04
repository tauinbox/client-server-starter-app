import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import type { Translation } from '@jsverse/transloco';
import { LanguageService } from './language.service';

describe('LanguageService', () => {
  let transloco: TranslocoService;
  let service: LanguageService;

  beforeEach(async () => {
    localStorage.clear();
    // No preload: the service learns the scopes from the load events, which a
    // preload sends before the service exists.
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { en: {}, ru: {}, 'users/en': { title: 'Users' } },
          translocoConfig: { availableLangs: ['en', 'ru'], defaultLang: 'en' }
        })
      ]
    });
    transloco = TestBed.inject(TranslocoService);
    service = TestBed.inject(LanguageService);
    await firstValueFrom(transloco.load('users/en'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('loads the new language and each loaded scope before it switches', async () => {
    const calls: string[] = [];
    vi.spyOn(transloco, 'load').mockImplementation((path) => {
      calls.push(`load ${path}`);
      return of({});
    });
    vi.spyOn(transloco, 'setActiveLang').mockImplementation((lang) => {
      calls.push(`activate ${lang}`);
      return transloco;
    });

    await service.setLanguage('ru');

    expect(calls).toEqual(['load ru', 'load users/ru', 'activate ru']);
    expect(service.language()).toBe('ru');
  });

  it('switches when a file fails to load', async () => {
    vi.spyOn(transloco, 'load').mockImplementation((path) =>
      path === 'users/ru' ? throwError(() => new Error('offline')) : of({})
    );

    await service.setLanguage('ru');

    expect(transloco.getActiveLang()).toBe('ru');
  });

  it('keeps the last requested language when an earlier load ends later', async () => {
    const ruLoaded = new Subject<Translation>();
    vi.spyOn(transloco, 'load').mockImplementation((path) =>
      path.endsWith('ru') ? ruLoaded : of({})
    );

    const toRu = service.setLanguage('ru');
    await service.setLanguage('en');
    ruLoaded.next({});
    ruLoaded.complete();
    await toRu;

    expect(transloco.getActiveLang()).toBe('en');
    expect(service.language()).toBe('en');
  });
});
