import { ErrorKeys } from '@app/shared/constants';
import type { SignedTokenRefusal } from '@app/shared/utils/token-revocation';
import { ApiError } from '../../../common/errors/api-error';

/**
 * A refusal of an account that the server found from a value it trusts: a
 * linked identity or a signed intent. It carries the account id and the
 * reason, so the audit row of the refusal can name both.
 */
export class AccountRefusedException extends ApiError {
  constructor(
    readonly userId: string,
    readonly refusal: SignedTokenRefusal
  ) {
    super(
      refusal === 'session_revoked'
        ? ErrorKeys.AUTH.TOKEN_REVOKED
        : ErrorKeys.AUTH.USER_NOT_FOUND_OR_DEACTIVATED,
      refusal === 'session_revoked'
        ? 'Token has been revoked'
        : 'User account not found or deactivated'
    );
  }
}
