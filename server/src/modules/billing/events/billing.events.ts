/**
 * Billing domain events (EventEmitter2 — no forwardRef across module boundaries,
 * per the cross-module communication rule). Emitted by the subscription/invoice
 * reducers once a verified provider webhook is applied. Every event carries
 * the affected `userId` so the entitlement-cache listener can invalidate exactly
 * that user without re-querying the customer mapping.
 */

export class SubscriptionActivatedEvent {
  constructor(
    public readonly userId: string,
    public readonly subscriptionId: string
  ) {}
}

export class SubscriptionRenewedEvent {
  constructor(
    public readonly userId: string,
    public readonly subscriptionId: string
  ) {}
}

export class SubscriptionPastDueEvent {
  constructor(
    public readonly userId: string,
    public readonly subscriptionId: string
  ) {}
}

export class SubscriptionCanceledEvent {
  constructor(
    public readonly userId: string,
    public readonly subscriptionId: string
  ) {}
}

export class PlanChangedEvent {
  constructor(
    public readonly userId: string,
    public readonly subscriptionId: string,
    public readonly fromPlanKey: string,
    public readonly toPlanKey: string
  ) {}
}

export class InvoicePaidEvent {
  constructor(
    public readonly userId: string,
    public readonly invoiceId: string
  ) {}
}

/**
 * A self-managed first payment was paid but activated nothing: the row was
 * already active, carried another plan, or was cancelled. The money must go
 * back in full.
 */
export class FirstPaymentUnclaimedEvent {
  constructor(
    public readonly userId: string,
    public readonly invoiceId: string
  ) {}
}

/** A full refund of a one-time purchase revoked the grants it gave. */
export class InvoiceRefundedEvent {
  constructor(
    public readonly userId: string,
    public readonly invoiceId: string
  ) {}
}

export class PaymentFailedEvent {
  constructor(
    public readonly userId: string,
    public readonly subscriptionId: string | null
  ) {}
}

/**
 * A credit delta moved the balance across zero: the pay-as-you-go
 * entitlements start or stop. A purchase is not sent here, because every paid
 * invoice already sends `InvoicePaidEvent`.
 */
export class CreditBalanceCrossedEvent {
  constructor(public readonly userId: string) {}
}

/** Event-name keys an entitlement-affecting billing change is published under. */
export const ENTITLEMENT_CHANGING_EVENTS = [
  SubscriptionActivatedEvent.name,
  SubscriptionRenewedEvent.name,
  SubscriptionPastDueEvent.name,
  SubscriptionCanceledEvent.name,
  PlanChangedEvent.name,
  InvoicePaidEvent.name,
  InvoiceRefundedEvent.name,
  PaymentFailedEvent.name,
  CreditBalanceCrossedEvent.name
];
