import { randomUUID } from 'crypto';
import type {
  UserNotificationContent,
  UserNotificationResponse
} from '@app/shared/types';
import { renewalAnchor } from '@app/shared/utils/billing-rules';
import { getState } from '../state';
import { pushToUser } from '../sse-hub';
import type {
  MockInvoice,
  MockSubscription,
  MockUserNotification
} from '../types';

/** Mirrors the stored row of `UserNotificationsService.notify`. */
export function storeUserNotification(
  userId: string,
  content: UserNotificationContent
): MockUserNotification {
  const state = getState();
  const user = state.users.get(userId);
  const notice: MockUserNotification = {
    ...content,
    id: randomUUID(),
    userId,
    createdAt: new Date().toISOString(),
    readAt: null
  };

  // A deleted user gets nothing. The mock sends no mail.
  if (!user || user.deletedAt) return notice;

  state.userNotifications.set(notice.id, notice);
  pushToUser(userId, { type: 'notification_created' });

  return notice;
}

export function toUserNotificationResponse({
  userId: _userId,
  ...notice
}: MockUserNotification): UserNotificationResponse {
  return notice;
}

function ownerOf(customerId: string): string | undefined {
  return getState().billingCustomers.get(customerId)?.userId;
}

function planName(subscription: MockSubscription): string {
  return (
    getState()
      .plans.values()
      .find((p) => p.key === subscription.planKey)?.name ?? subscription.planKey
  );
}

/*
 * The functions below mirror the handlers of `BillingNoticesListener`. Each
 * one runs where the server emits the matching billing event.
 */

/** `InvoicePaidEvent`: a zero invoice moved no money, so it gets no notice. */
export function noticeInvoicePaid(invoice: MockInvoice): void {
  const userId = ownerOf(invoice.customerId);

  if (!userId || invoice.amountMinor === 0) return;

  storeUserNotification(userId, {
    kind: 'invoice_paid',
    payload: {
      invoiceId: invoice.id,
      amountMinor: invoice.amountMinor,
      currency: invoice.currency
    }
  });
}

/** `PaymentFailedEvent`, read after the dunning write. */
export function noticePaymentFailed(
  subscription: MockSubscription,
  nextAttemptAt: string | null
): void {
  const userId = ownerOf(subscription.customerId);

  if (!userId) return;

  storeUserNotification(userId, {
    kind: 'payment_failed',
    payload: {
      subscriptionId: subscription.id,
      planName: planName(subscription),
      subscriptionStatus: subscription.status,
      nextAttemptAt
    }
  });
}

/** `SubscriptionCancelScheduledEvent`. */
export function noticeCancelScheduled(subscription: MockSubscription): void {
  const userId = ownerOf(subscription.customerId);

  if (!userId) return;

  storeUserNotification(userId, {
    kind: 'subscription_cancel_scheduled',
    payload: {
      subscriptionId: subscription.id,
      planName: planName(subscription),
      accessEndsAt: renewalAnchor(subscription)
    }
  });
}

/** `SubscriptionCanceledEvent`. */
export function noticeCanceled(subscription: MockSubscription): void {
  const userId = ownerOf(subscription.customerId);

  if (!userId) return;

  storeUserNotification(userId, {
    kind: 'subscription_canceled',
    payload: {
      subscriptionId: subscription.id,
      planName: planName(subscription)
    }
  });
}

/** `RenewalUpcomingEvent`: the coming charge of a self-managed renewal. */
export function noticeRenewalUpcoming(
  subscription: MockSubscription,
  amount: { amountMinor: number; currency: string }
): void {
  const userId = ownerOf(subscription.customerId);

  if (!userId) return;

  storeUserNotification(userId, {
    kind: 'renewal_upcoming',
    payload: {
      subscriptionId: subscription.id,
      planName: planName(subscription),
      renewsAt: renewalAnchor(subscription),
      ...amount
    }
  });
}

/** `RefundIssuedEvent`: one for each refund leg that the provider accepted. */
export function noticeRefundIssued(
  invoice: MockInvoice,
  amountMinor: number
): void {
  const userId = ownerOf(invoice.customerId);

  if (!userId) return;

  storeUserNotification(userId, {
    kind: 'refund_issued',
    payload: { invoiceId: invoice.id, amountMinor, currency: invoice.currency }
  });
}

/** `CreditBalanceCrossedEvent`: only a balance at or below 0 is a notice. */
export function noticeCreditBalanceCrossed(
  customerId: string,
  balanceAfter: number
): void {
  const userId = ownerOf(customerId);

  if (!userId || balanceAfter > 0) return;

  storeUserNotification(userId, {
    kind: 'credit_balance_depleted',
    payload: {}
  });
}
