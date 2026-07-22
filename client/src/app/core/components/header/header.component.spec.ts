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

  it('should reformat the build date when the active language changes', () => {
    const inEnglish = component['appVersion']();
    language.set('ru');
    const inRussian = component['appVersion']();

    expect(inEnglish).not.toBe(inRussian);
    expect(inRussian).toContain('v');
  });
});
