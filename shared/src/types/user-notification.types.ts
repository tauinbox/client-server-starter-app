import type { SubscriptionStatus } from './billing.types';

/** An amount of money as the invoices send it: minor units and an ISO code. */
export interface NoticeAmount {
  amountMinor: number;
  currency: string;
}

/**
 * The content of each kind of stored notice. A payload holds only data of the
 * user it is for: no card data and no value of another user. A notice records
 * one moment, so it keeps the plan name of that moment, not a key to look up.
 * Instants are ISO 8601 strings.
 */
export interface UserNotificationPayloads {
  invoice_paid: NoticeAmount & { invoiceId: string };
  /**
   * The dunning state after the failure: `past_due` waits for another
   * attempt (at `nextAttemptAt` when this server charges, at a time of the
   * provider when it is null), `canceled` means the attempts are finished.
   * Null fields: the failed payment belongs to no subscription.
   */
  payment_failed: {
    subscriptionId: string | null;
    planName: string | null;
    subscriptionStatus: SubscriptionStatus | null;
    nextAttemptAt: string | null;
  };
  subscription_cancel_scheduled: {
    subscriptionId: string;
    planName: string;
    accessEndsAt: string;
  };
  subscription_canceled: { subscriptionId: string; planName: string };
  /**
   * The saved card is charged at `renewsAt` for the next period, at the
   * amount of the plan at the time of the notice.
   */
  renewal_upcoming: NoticeAmount & {
    subscriptionId: string;
    planName: string;
    renewsAt: string;
  };
  refund_issued: NoticeAmount & { invoiceId: string };
  credit_balance_depleted: Record<string, never>;
}

export type UserNotificationKind = keyof UserNotificationPayloads;

/** The kind and the payload, typed together so that a writer cannot mix them. */
export type UserNotificationContent = {
  [K in UserNotificationKind]: {
    kind: K;
    payload: UserNotificationPayloads[K];
  };
}[UserNotificationKind];

export type UserNotificationResponse = UserNotificationContent & {
  id: string;
  createdAt: string;
  readAt: string | null;
};

export interface UserNotificationUnreadCountResponse {
  unread: number;
}
