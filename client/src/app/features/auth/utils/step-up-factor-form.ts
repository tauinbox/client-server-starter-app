import { computed, signal } from '@angular/core';
import type { Signal, WritableSignal } from '@angular/core';
import { form, required } from '@angular/forms/signals';
import type { FieldTree } from '@angular/forms/signals';
import type { UserResponse } from '@app/shared/types';
import type { MfaStepUpRequest } from '../models/auth.types';

/**
 * The factor an account proves itself with before a sensitive change. `none`
 * is an account with neither a password nor an authenticator: only a provider
 * round trip can prove it, and no form field does.
 */
export type StepUpFactor = 'password' | 'code' | 'none';

export function stepUpFactorOf(
  user: Pick<UserResponse, 'hasPassword' | 'mfaEnabled'> | null | undefined
): StepUpFactor {
  if (user?.hasPassword !== false) return 'password';
  return user.mfaEnabled ? 'code' : 'none';
}

export type StepUpFactorMessages = {
  passwordRequired: string;
  codeRequired: string;
};

export type StepUpFactorForm = {
  passwordModel: WritableSignal<{ currentPassword: string }>;
  passwordForm: FieldTree<{ currentPassword: string }>;
  codeModel: WritableSignal<{ code: string }>;
  codeForm: FieldTree<{ code: string }>;
  /** True while the field of the current factor has no value, and always for `none`. */
  invalid: Signal<boolean>;
  /** Exactly one of the two fields, because the server DTO rejects unknown ones. */
  request(): MfaStepUpRequest;
  /** Clears both values and the touched state, so a reopened prompt shows no stale error. */
  reset(): void;
};

/** Must run in an injection context, as `form()` does. */
export function createStepUpFactorForm(
  factor: Signal<StepUpFactor>,
  messages: StepUpFactorMessages
): StepUpFactorForm {
  const passwordModel = signal({ currentPassword: '' });
  const passwordForm = form(passwordModel, (path) => {
    required(path.currentPassword, { message: messages.passwordRequired });
  });

  const codeModel = signal({ code: '' });
  const codeForm = form(codeModel, (path) => {
    required(path.code, { message: messages.codeRequired });
  });

  const invalid = computed(() => {
    switch (factor()) {
      case 'password':
        return passwordForm().invalid();
      case 'code':
        return codeForm().invalid();
      default:
        return true;
    }
  });

  return {
    passwordModel,
    passwordForm,
    codeModel,
    codeForm,
    invalid,
    request: () =>
      factor() === 'code'
        ? { code: codeModel().code.trim() }
        : { currentPassword: passwordModel().currentPassword },
    reset: () => {
      passwordForm().reset({ currentPassword: '' });
      codeForm().reset({ code: '' });
    }
  };
}
