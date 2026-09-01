import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';

import {
  PasswordStrengthComponent,
  calculatePasswordStrength
} from './password-strength.component';

describe('calculatePasswordStrength', () => {
  it('returns 0 for empty input', () => {
    expect(calculatePasswordStrength('')).toBe(0);
  });

  it('returns 1 (Weak) for a tiny lowercase-only password', () => {
    expect(calculatePasswordStrength('abc')).toBe(1);
  });

  it('returns 2 (Fair) for length-only without case mix or digits', () => {
    expect(calculatePasswordStrength('abcdefgh')).toBe(2);
  });

  it('returns 3 (Good) when length, lowercase and uppercase are present but no digit', () => {
    expect(calculatePasswordStrength('Abcdefgh')).toBe(3);
  });

  it('returns 4 (Strong) when all PASSWORD_REGEX rules are satisfied', () => {
    expect(calculatePasswordStrength('Abcdefg1')).toBe(4);
  });

  it('returns 4 (Strong) for a long mixed password', () => {
    expect(calculatePasswordStrength('Str0ngPassword!')).toBe(4);
  });

  it('returns 1 (Weak) for a single uppercase letter (Math.max floor)', () => {
    expect(calculatePasswordStrength('A')).toBe(1);
  });
});

describe('PasswordStrengthComponent', () => {
  let fixture: ComponentFixture<PasswordStrengthComponent>;
  let component: PasswordStrengthComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PasswordStrengthComponent, TranslocoTestingModuleWithLangs],
      providers: [provideNoopAnimations()]
    }).compileComponents();

    fixture = TestBed.createComponent(PasswordStrengthComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('password', '');
    fixture.detectChanges();
  });

  it('hides the meter when password is empty', () => {
    const root: HTMLElement = fixture.nativeElement;
    const container = root.querySelector('.password-strength');
    expect(container).not.toBeNull();
    expect(container?.getAttribute('data-strength')).toBe('0');
    expect(root.querySelector('.strength-bars')).toBeNull();
    expect(root.querySelector('.strength-label')).toBeNull();
  });

  it('renders the Weak label and 1 filled bar for a tiny password', () => {
    fixture.componentRef.setInput('password', 'abc');
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    expect(component.score()).toBe(1);
    expect(
      root.querySelector('.password-strength')?.getAttribute('data-strength')
    ).toBe('1');
    const filled = root.querySelectorAll('.strength-bar.filled');
    expect(filled.length).toBe(1);
    expect(root.querySelector('.strength-label')?.textContent?.trim()).toBe(
      'Weak'
    );
  });

  it('renders the Strong label and 4 filled bars for a strong password', () => {
    fixture.componentRef.setInput('password', 'Str0ngPassword!');
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    expect(component.score()).toBe(4);
    const filled = root.querySelectorAll('.strength-bar.filled');
    expect(filled.length).toBe(4);
    expect(root.querySelector('.strength-label')?.textContent?.trim()).toBe(
      'Strong'
    );
  });

  it('renders the Good label for an 8-char mixed-case password without digits', () => {
    fixture.componentRef.setInput('password', 'Abcdefgh');
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    expect(component.score()).toBe(3);
    expect(root.querySelector('.strength-label')?.textContent?.trim()).toBe(
      'Good'
    );
  });

  describe('composition requirements hint', () => {
    const HINT = '.password-requirements';

    it('stays hidden while the field is empty', () => {
      const root: HTMLElement = fixture.nativeElement;
      expect(root.querySelector(HINT)).toBeNull();
    });

    it('states the rule while the typed value breaks it', () => {
      fixture.componentRef.setInput('password', 'passwordonly');
      fixture.detectChanges();

      const hint: HTMLElement | null =
        fixture.nativeElement.querySelector(HINT);
      expect(hint).not.toBeNull();
      expect(hint?.textContent).toContain('uppercase');
      expect(hint?.textContent).toContain('lowercase');
      expect(hint?.textContent).toContain('number');
    });

    it('disappears once the value satisfies the rule', () => {
      fixture.componentRef.setInput('password', 'passwordonly');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector(HINT)).not.toBeNull();

      fixture.componentRef.setInput('password', 'Password1');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector(HINT)).toBeNull();
    });
  });

  it('exposes a polite live region for screen readers', () => {
    fixture.componentRef.setInput('password', 'Abcdefg1');
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    const label = root.querySelector('.strength-label');
    expect(label?.getAttribute('aria-live')).toBe('polite');

    const container = root.querySelector('.password-strength');
    expect(container?.getAttribute('role')).toBe('progressbar');
    expect(container?.getAttribute('aria-valuemin')).toBe('0');
    expect(container?.getAttribute('aria-valuemax')).toBe('4');
    expect(container?.getAttribute('aria-valuenow')).toBe('4');
    expect(container?.getAttribute('aria-valuetext')).toBe('Strong');
  });
});
