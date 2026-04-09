import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Component, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';
import { AppFormFieldComponent } from './app-form-field.component';

@Component({
  selector: 'app-test-host',
  imports: [AppFormFieldComponent, ReactiveFormsModule],
  template: `
    <app-form-field
      [control]="control"
      [label]="label"
      [type]="type"
      [errors]="errors"
      [prefixIcon]="prefixIcon"
      [hint]="hint"
      [autocomplete]="autocomplete"
    >
      <button formFieldSuffix type="button" class="test-suffix">Toggle</button>
    </app-form-field>
  `
})
class TestHostComponent {
  control = new FormControl('', {
    validators: [Validators.required, Validators.email],
    nonNullable: true
  });
  label = 'forms.errors.email';
  type: 'text' | 'email' | 'password' | 'textarea' = 'email';
  errors: Record<string, string> = {};
  prefixIcon = 'email';
  hint = '';
  autocomplete = 'on';

  readonly formField = viewChild(AppFormFieldComponent);
}

describe('AppFormFieldComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent, TranslocoTestingModuleWithLangs],
      providers: [provideNoopAnimations()]
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(host.formField()).toBeTruthy();
  });

  describe('error rendering', () => {
    it('should show error when control is touched and invalid', () => {
      host.control.markAsTouched();
      fixture.detectChanges();

      const errorEl = fixture.nativeElement.querySelector('mat-error');
      expect(errorEl).toBeTruthy();
      expect(errorEl.textContent).toContain('This field is required');
    });

    it('should show email error when value is invalid email', () => {
      host.control.setValue('bad');
      host.control.markAsTouched();
      // Double detectChanges: first propagates control value, second
      // re-evaluates the error key after validation runs.
      fixture.detectChanges();
      fixture.detectChanges();

      const errorEl = fixture.nativeElement.querySelector('mat-error');
      expect(errorEl).toBeTruthy();
      expect(errorEl.textContent).toContain('valid email');
    });

    it('should not show error when control is valid', () => {
      host.control.setValue('test@example.com');
      host.control.markAsTouched();
      fixture.detectChanges();

      const errorEl = fixture.nativeElement.querySelector('mat-error');
      expect(errorEl).toBeNull();
    });
  });

  describe('error key override', () => {
    it('should use per-field error override instead of default', () => {
      host.errors = { required: 'auth.login.passwordRequired' };
      host.control.markAsTouched();
      fixture.detectChanges();

      const errorEl = fixture.nativeElement.querySelector('mat-error');
      expect(errorEl).toBeTruthy();
      expect(errorEl.textContent).toContain('Password is required');
    });
  });

  describe('aria-describedby linkage', () => {
    it('should set aria-describedby on input when error is shown', () => {
      host.control.markAsTouched();
      fixture.detectChanges();

      const input = fixture.nativeElement.querySelector('input');
      const errorEl = fixture.nativeElement.querySelector('mat-error');
      expect(input.getAttribute('aria-describedby')).toContain(errorEl.id);
    });

    it('should not set aria-describedby when control is valid', () => {
      host.control.setValue('test@example.com');
      host.control.markAsTouched();
      fixture.detectChanges();

      const input = fixture.nativeElement.querySelector('input');
      const describedBy = input.getAttribute('aria-describedby') ?? '';
      expect(describedBy).not.toContain('app-ff-err-');
    });
  });

  describe('prefix icon', () => {
    it('should render prefix icon with aria-hidden', () => {
      const icon = fixture.nativeElement.querySelector(
        'mat-icon[aria-hidden="true"]'
      );
      expect(icon).toBeTruthy();
      expect(icon.textContent.trim()).toBe('email');
    });

    it('should not render prefix icon when not provided', () => {
      host.prefixIcon = '';
      fixture.detectChanges();

      // prefixIcon() is falsy empty string → @if(prefixIcon()) is false
      const icons = fixture.nativeElement.querySelectorAll(
        'mat-icon[matprefix]'
      );
      expect(icons.length).toBe(0);
    });
  });

  describe('hint', () => {
    it('should render hint when provided', () => {
      host.hint = 'forms.errors.unknown';
      fixture.detectChanges();

      const hintEl = fixture.nativeElement.querySelector('mat-hint');
      expect(hintEl).toBeTruthy();
    });

    it('should not render hint when not provided', () => {
      const hintEl = fixture.nativeElement.querySelector('mat-hint');
      expect(hintEl).toBeNull();
    });
  });

  describe('autocomplete pass-through', () => {
    it('should set autocomplete attribute on input', () => {
      const input = fixture.nativeElement.querySelector('input');
      expect(input.getAttribute('autocomplete')).toBe('on');
    });
  });

  describe('suffix projection', () => {
    it('should project suffix content', () => {
      const suffix = fixture.nativeElement.querySelector('.test-suffix');
      expect(suffix).toBeTruthy();
      expect(suffix.textContent).toBe('Toggle');
    });
  });

  describe('textarea mode', () => {
    it('should render textarea when type is textarea', () => {
      host.type = 'textarea';
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('textarea');
      expect(textarea).toBeTruthy();
      const input = fixture.nativeElement.querySelector('input');
      expect(input).toBeNull();
    });
  });
});
