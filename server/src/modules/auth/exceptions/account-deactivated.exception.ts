import { ErrorKeys } from '@app/shared/constants';
import { ApiError } from '../../../common/errors/api-error';

/**
 * A sign-in for a deactivated account. It carries the id of the account, so
 * the audit row of the refusal can name it as the target.
 */
export class AccountDeactivatedException extends ApiError {
  constructor(readonly userId: string) {
    super(ErrorKeys.AUTH.USER_DEACTIVATED, 'User account is deactivated');
  }
}
