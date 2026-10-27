import { ErrorKeys } from '@app/shared/constants';
import { ApiError } from '../../../common/errors/api-error';

export function subscriptionNotLinked(): ApiError {
  return new ApiError(
    ErrorKeys.BILLING.SUBSCRIPTION_NOT_LINKED,
    'The subscription is not linked to the provider yet. Try again shortly.'
  );
}

export function planNotFound(planKey: string): ApiError {
  return new ApiError(
    ErrorKeys.BILLING.PLAN_NOT_FOUND,
    `Plan "${planKey}" was not found`
  );
}

export function currentPlanMissing(): ApiError {
  return new ApiError(
    ErrorKeys.BILLING.CURRENT_PLAN_MISSING,
    'The current plan is missing from the catalog'
  );
}
