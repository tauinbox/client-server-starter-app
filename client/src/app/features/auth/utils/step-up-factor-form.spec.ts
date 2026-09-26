import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { StepUpFactor } from './step-up-factor-form';
import { createStepUpFactorForm, stepUpFactorOf } from './step-up-factor-form';

describe('stepUpFactorOf', () => {
  it('picks the password while the account has one or is not loaded', () => {
    expect(stepUpFactorOf(null)).toBe('password');
    expect(stepUpFactorOf({ hasPassword: true, mfaEnabled: true })).toBe(
      'password'
    );
  });

  it('picks the code for an account with no password and an authenticator', () => {
    expect(stepUpFactorOf({ hasPassword: false, mfaEnabled: true })).toBe(
      'code'
    );
  });

  it('picks none for an account with neither factor', () => {
    expect(stepUpFactorOf({ hasPassword: false, mfaEnabled: false })).toBe(
      'none'
    );
  });
});

describe('createStepUpFactorForm', () => {
  function create(initial: StepUpFactor) {
    const factor = signal<StepUpFactor>(initial);
    const stepUp = runInInjectionContext(TestBed.inject(Injector), () =>
      createStepUpFactorForm(factor, {
        passwordRequired: 'test.passwordRequired',
        codeRequired: 'test.codeRequired'
      })
    );
    return { factor, stepUp };
  }

  it('checks only the field of the current factor', () => {
    const { factor, stepUp } = create('password');
    expect(stepUp.invalid()).toBe(true);

    stepUp.passwordModel.set({ currentPassword: 'secret' });
    expect(stepUp.invalid()).toBe(false);

    factor.set('code');
    expect(stepUp.invalid()).toBe(true);

    stepUp.codeModel.set({ code: '123456' });
    expect(stepUp.invalid()).toBe(false);
  });

  it('is always invalid for none', () => {
    const { stepUp } = create('none');
    stepUp.passwordModel.set({ currentPassword: 'secret' });
    stepUp.codeModel.set({ code: '123456' });
    expect(stepUp.invalid()).toBe(true);
  });

  it('sends exactly one field, with the code trimmed', () => {
    const { factor, stepUp } = create('password');
    stepUp.passwordModel.set({ currentPassword: ' secret ' });
    stepUp.codeModel.set({ code: ' 123456 ' });
    expect(stepUp.request()).toEqual({ currentPassword: ' secret ' });

    factor.set('code');
    expect(stepUp.request()).toEqual({ code: '123456' });
  });

  it('clears both values and the touched state on reset', () => {
    const { stepUp } = create('password');
    stepUp.passwordModel.set({ currentPassword: 'secret' });
    stepUp.codeModel.set({ code: '123456' });
    stepUp.passwordForm.currentPassword().markAsTouched();
    stepUp.codeForm.code().markAsTouched();

    stepUp.reset();

    expect(stepUp.passwordModel()).toEqual({ currentPassword: '' });
    expect(stepUp.codeModel()).toEqual({ code: '' });
    expect(stepUp.passwordForm.currentPassword().touched()).toBe(false);
    expect(stepUp.codeForm.code().touched()).toBe(false);
  });
});
