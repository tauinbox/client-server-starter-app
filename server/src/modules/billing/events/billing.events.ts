/**
 * Billing domain events (EventEmitter2 — no forwardRef across module boundaries,
 * per the cross-module communication rule). Emitted by the subscription/invoice
 * reducers (M1+) once a verified provider webhook is applied. Every event carries
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

/**
 * A provider-managed usage subscription rolled over its billing period (the
 * provider's renewal webhook moved `current_period_*` forward). Carries the
 * closed period so the usage-invoicing listener can rate and charge it
 * postpaid. Self-managed (YooKassa) closes are charged inline by the renewal
 * scheduler and never emit this.
 */
export class UsagePeriodClosedEvent {
  constructor(
    public readonly userId: string,
    public readonly subscriptionId: string,
    public readonly periodStart: Date,
    public readonly periodEnd: Date
  ) {}
}

export class InvoicePaidEvent {
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

/** Event-name keys an entitlement-affecting billing change is published under. */
export const ENTITLEMENT_CHANGING_EVENTS = [
  SubscriptionActivatedEvent.name,
  SubscriptionRenewedEvent.name,
  SubscriptionPastDueEvent.name,
  SubscriptionCanceledEvent.name,
  PlanChangedEvent.name,
  InvoicePaidEvent.name,
  PaymentFailedEvent.name
];
