import { firstValueFrom, of } from 'rxjs';
import type { ConfirmDialogData } from '@shared/components/confirm-dialog/confirm-dialog.component';
import {
  confirmEnableForEveryone,
  hasIncludeRule
} from './feature-flag-enable-confirm';

describe('hasIncludeRule', () => {
  it('is false for no rules and for exclude-only rules', () => {
    expect(hasIncludeRule([])).toBe(false);
    expect(hasIncludeRule([{ effect: 'exclude' }])).toBe(false);
  });

  it('is true when one rule includes', () => {
    expect(hasIncludeRule([{ effect: 'exclude' }, { effect: 'include' }])).toBe(
      true
    );
  });
});

describe('confirmEnableForEveryone', () => {
  const transloco = {
    translate: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key
  };

  function dialogReturning(answer: boolean | undefined) {
    const openConfirm = vi.fn((_data: ConfirmDialogData) => of(answer));
    return { openConfirm };
  }

  it('asks with the translated texts and the flag key', async () => {
    const dialog = dialogReturning(true);
    await firstValueFrom(confirmEnableForEveryone(dialog, transloco, 'beta'));
    expect(dialog.openConfirm).toHaveBeenCalledWith({
      title: 'admin.featureFlags.confirmEnableNoRulesTitle',
      message: 'admin.featureFlags.confirmEnableNoRulesMessage:{"key":"beta"}',
      confirmButton: 'common.confirm',
      cancelButton: 'common.cancel'
    });
  });

  it.each([
    [true, true],
    [false, false],
    [undefined, false]
  ])('maps the answer %s to %s', async (answer, expected) => {
    const result = await firstValueFrom(
      confirmEnableForEveryone(dialogReturning(answer), transloco, 'beta')
    );
    expect(result).toBe(expected);
  });
});
