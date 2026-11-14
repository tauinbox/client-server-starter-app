import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';

import { HeaderComponent } from './header.component';
import { AuthStore } from '@features/auth/store/auth.store';
import { AuthService } from '@features/auth/services/auth.service';
import type { AppLanguage } from '@core/services/language.service';
import { LanguageService } from '@core/services/language.service';
import { signal } from '@angular/core';
import { UnreadNoticesService } from '@features/billing/services/unread-notices.service';

describe('HeaderComponent', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;
  const language = signal<AppLanguage>('en');

  beforeEach(async () => {
    language.set('en');
    await TestBed.configureTestingModule({
      imports: [HeaderComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        {
          provide: AuthStore,
          useValue: {
            isAuthenticated: vi.fn().mockReturnValue(false),
            user: vi.fn().mockReturnValue(null),
            hasPermissions: vi.fn().mockReturnValue(false)
          }
        },
        {
          provide: AuthService,
          useValue: { logout: vi.fn() }
        },
        {
          provide: LanguageService,
          useValue: { language: language.asReadonly() }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('notices bell', () => {
    const available = signal(false);
    const unread = signal(0);

    async function renderWithBell() {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [HeaderComponent, TranslocoTestingModuleWithLangs],
        providers: [
          provideRouter([]),
          {
            provide: AuthStore,
            useValue: {
              isAuthenticated: vi.fn().mockReturnValue(true),
              user: vi.fn().mockReturnValue({ name: 'Ann' }),
              hasPermissions: vi.fn().mockReturnValue(false)
            }
          },
          { provide: AuthService, useValue: { logout: vi.fn() } },
          {
            provide: LanguageService,
            useValue: { language: language.asReadonly() }
          },
          {
            provide: UnreadNoticesService,
            useValue: {
              available: available.asReadonly(),
              unread: unread.asReadonly()
            }
          }
        ]
      }).compileComponents();
      const bellFixture = TestBed.createComponent(HeaderComponent);

      bellFixture.detectChanges();

      return bellFixture.nativeElement as HTMLElement;
    }

    beforeEach(() => {
      available.set(false);
      unread.set(0);
    });

    it('is hidden where no notice can exist', async () => {
      const element = await renderWithBell();

      expect(element.querySelector('.notices-link')).toBeNull();
    });

    it('links to the notices and names the unread count', async () => {
      available.set(true);
      unread.set(2);
      const element = await renderWithBell();
      const link = element.querySelector<HTMLAnchorElement>('.notices-link');

      expect(link?.getAttribute('href')).toBe('/billing/notifications');
      expect(link?.getAttribute('aria-label')).toBe('Notifications, 2 unread');
    });
  });

  it('should reformat the build date when the active language changes', () => {
    const inEnglish = component['appVersion']();

    language.set('ru');
    const inRussian = component['appVersion']();

    expect(inEnglish).not.toBe(inRussian);
    expect(inRussian).toContain('v');
  });
});
