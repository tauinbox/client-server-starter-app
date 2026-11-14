import type { EntityManager } from 'typeorm';
import type { BillingProviderId } from '@app/shared/types';
import { Customer } from '../entities/customer.entity';
import { PaymentMethod } from '../entities/payment-method.entity';
import type { NormalizedSavedPaymentMethod } from '../providers/payment-provider.interface';

/**
 * Locks the customer row for a card write. The removal of the saved card and
 * each card writer take this lock, so a card cannot be saved between the
 * removal and its commit. `FOR NO KEY UPDATE` does not wait for the key-share
 * locks that an insert with a foreign key to the customer takes.
 */
export function lockCustomerForCard(
  manager: EntityManager,
  customerId: string
): Promise<Customer | null> {
  return manager.findOne(Customer, {
    where: { id: customerId },
    lock: { mode: 'for_no_key_update' }
  });
}

/**
 * True when the customer refused the saved card after the payment that saved
 * this card was created. A card with no creation time is refused when any
 * removal exists, because its order against the removal is not known.
 */
export function isCardRefused(
  customer: Pick<Customer, 'paymentMethodRemovedAt'>,
  saved: NormalizedSavedPaymentMethod
): boolean {
  const { paymentMethodRemovedAt: removedAt } = customer;

  if (!removedAt) {
    return false;
  }

  const consentedAt = saved.consentedAt ? Date.parse(saved.consentedAt) : NaN;

  return Number.isNaN(consentedAt) || consentedAt <= removedAt.getTime();
}

/**
 * Stores the card as the default method of the customer: the current default
 * is demoted first, so defaults never accumulate. Call it under
 * `lockCustomerForCard`, after `isCardRefused`.
 */
export async function saveDefaultCard(
  manager: EntityManager,
  {
    customerId,
    provider,
    saved
  }: {
    customerId: string;
    provider: BillingProviderId;
    saved: NormalizedSavedPaymentMethod;
  }
): Promise<PaymentMethod> {
  await manager.update(
    PaymentMethod,
    { customerId, isDefault: true },
    { isDefault: false }
  );
  const method = await manager.save(
    manager.create(PaymentMethod, {
      customerId,
      provider,
      providerMethodRef: saved.providerMethodRef,
      brand: saved.brand,
      last4: saved.last4,
      isDefault: true
    })
  );

  await manager.update(
    Customer,
    { id: customerId },
    { defaultPaymentMethodId: method.id }
  );

  return method;
}
