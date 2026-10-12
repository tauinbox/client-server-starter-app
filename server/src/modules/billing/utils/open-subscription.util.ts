import { NotFoundException } from '@nestjs/common';
import { In, type Repository } from 'typeorm';
import { ErrorKeys, OPEN_SUBSCRIPTION_STATUSES } from '@app/shared/constants';
import type { Customer } from '../entities/customer.entity';
import type { Subscription } from '../entities/subscription.entity';

/** The newest open subscription of a customer. */
export function findOpenSubscription(
  subscriptions: Repository<Subscription>,
  customerId: string
): Promise<Subscription | null> {
  return subscriptions.findOne({
    where: { customerId, status: In([...OPEN_SUBSCRIPTION_STATUSES]) },
    order: { createdAt: 'DESC' }
  });
}

/**
 * The caller's customer together with its open subscription, for the
 * mutations that need both. The 404 message is passed in - each flow keeps
 * its own wording.
 */
export async function requireOpenSubscription(
  repos: {
    customers: Repository<Customer>;
    subscriptions: Repository<Subscription>;
  },
  userId: string,
  notFoundMessage: string
): Promise<{ customer: Customer; subscription: Subscription }> {
  const customer = await repos.customers.findOne({ where: { userId } });
  const subscription = customer
    ? await findOpenSubscription(repos.subscriptions, customer.id)
    : null;
  if (!customer || !subscription) {
    throw new NotFoundException({
      message: notFoundMessage,
      errorKey: ErrorKeys.BILLING.NO_ACTIVE_SUBSCRIPTION
    });
  }
  return { customer, subscription };
}
