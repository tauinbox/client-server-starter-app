import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { ErrorKeys } from '@app/shared/constants';

export function subscriptionNotLinked(): ConflictException {
  return new ConflictException({
    message:
      'The subscription is not linked to the provider yet. Try again shortly.',
    errorKey: ErrorKeys.BILLING.SUBSCRIPTION_NOT_LINKED
  });
}

export function planNotFound(planKey: string): NotFoundException {
  return new NotFoundException({
    message: `Plan "${planKey}" was not found`,
    errorKey: ErrorKeys.BILLING.PLAN_NOT_FOUND
  });
}

export function currentPlanMissing(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    message: 'The current plan is missing from the catalog',
    errorKey: ErrorKeys.BILLING.CURRENT_PLAN_MISSING
  });
}
