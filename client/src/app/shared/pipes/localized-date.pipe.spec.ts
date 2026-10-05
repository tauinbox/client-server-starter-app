import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type AppLanguage,
  LanguageService
} from '@core/services/language.service';
import {
  type LocalizedDateFormat,
  LocalizedDatePipe
} from './localized-date.pipe';

const VALUE = '2026-11-02T04:57:13.463Z';

@Component({
  imports: [LocalizedDatePipe],
  template: `<span data-testid="date">{{
    value() | localizedDate: format() : timeZone()
  }}</span>`,
  changeDetection: ChangeDetectionStrategy.OnPush
})
class HostComponent {
  readonly value = signal<string | null | undefined>(VALUE);
  readonly format = signal<LocalizedDateFormat>('mediumDate');
  readonly timeZone = signal<string | undefined>('UTC');
}

describe('LocalizedDatePipe', () => {
  const language = signal<AppLanguage>('en');

  beforeEach(() => {
    language.set('en');
    TestBed.configureTestingModule({
      providers: [{ provide: LanguageService, useValue: { language } }]
    });
  });

  function render(
    setup?: (host: HostComponent) => void
  ): () => string | null | undefined {
    const fixture = TestBed.createComponent(HostComponent);
    setup?.(fixture.componentInstance);
    fixture.detectChanges();
    const span = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="date"]'
    );
    return () => {
      fixture.detectChanges();
      return span?.textContent;
    };
  }

  it('formats a medium date in English', () => {
    expect(render()()).toBe('Nov 2, 2026');
  });

  it('formats a medium date in Russian', () => {
    language.set('ru');
    expect(render()()).toBe('2 нояб. 2026 г.');
  });

  it('formats a medium date and time in English', () => {
    const text = render((host) => host.format.set('medium'));
    expect(text()).toBe('Nov 2, 2026, 4:57:13 AM');
  });

  it('formats a short date and time in English and Russian', () => {
    expect(render((host) => host.format.set('short'))()).toBe(
      '11/2/26, 4:57 AM'
    );
    language.set('ru');
    expect(render((host) => host.format.set('short'))()).toBe(
      '02.11.2026, 04:57'
    );
  });

  it('applies the time zone argument', () => {
    const text = render((host) => {
      host.value.set('2026-11-01T23:30:00.000Z');
      host.timeZone.set('Asia/Tokyo');
    });
    expect(text()).toBe('Nov 2, 2026');
  });

  it('re-renders an OnPush host when the language changes at runtime', () => {
    const text = render();
    expect(text()).toBe('Nov 2, 2026');

    language.set('ru');
    expect(text()).toBe('2 нояб. 2026 г.');
  });

  it('renders an empty string for null and undefined', () => {
    expect(render((host) => host.value.set(null))()).toBe('');
    expect(render((host) => host.value.set(undefined))()).toBe('');
  });
});
