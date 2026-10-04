import type { Observable } from 'rxjs';
import { map } from 'rxjs';
import type { FeatureFlagRuleEffect } from '@app/shared/constants';
import type { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';

type Translator = {
  translate: (key: string, params?: Record<string, unknown>) => string;
};

// The evaluator turns an enabled flag with no include rule on for every
// authenticated user, so the admin confirms that intent before it happens.
export function hasIncludeRule(
  rules: readonly { effect: FeatureFlagRuleEffect }[]
): boolean {
  return rules.some((r) => r.effect === 'include');
}

export function confirmEnableForEveryone(
  adaptiveDialog: Pick<AdaptiveDialogService, 'openConfirm'>,
  transloco: Translator,
  key: string
): Observable<boolean> {
  return adaptiveDialog
    .openConfirm({
      title: transloco.translate(
        'admin.featureFlags.confirmEnableNoRulesTitle'
      ),
      message: transloco.translate(
        'admin.featureFlags.confirmEnableNoRulesMessage',
        { key }
      ),
      confirmButton: transloco.translate('common.confirm'),
      cancelButton: transloco.translate('common.cancel')
    })
    .pipe(map((confirmed) => confirmed === true));
}
