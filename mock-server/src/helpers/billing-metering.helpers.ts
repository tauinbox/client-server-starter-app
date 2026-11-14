import { randomUUID } from 'crypto';
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  ErrorKeys,
  METERS,
  type ErrorKey,
  type MeterKey
} from '@app/shared/constants';
import type { MeteringResponse } from '@app/shared/types';
import { getState } from '../state';
import type { MockPlan, MockUsageRecord } from '../types';
import {
  applyCreditDelta,
  crossesZero,
  notifyEntitlementsChanged
} from './billing-settle.helpers';

/**
 * Mirrors the server's EntitlementService.subscriptionPlan: the plan of the
 * newest entitled subscription of the customer.
 */
export function subscriptionPlan(customerId: string): MockPlan | undefined {
  const state = getState();
  const [subscription] = [...state.billingSubscriptions.values()]
    .filter(
      (s) =>
        s.customerId === customerId &&
        ENTITLED_SUBSCRIPTION_STATUSES.includes(s.status)
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));

  return subscription
    ? state.plans.values().find((p) => p.key === subscription.planKey)
    : undefined;
}

export interface MeteredUse {
  meterKey: MeterKey;
  units: number;
  idempotencyKey: string;
  occurredAt: string;
  /** The `occurredAt` of the request; a replay compares time only when it is set. */
  requestedOccurredAt?: string;
}

export type MeteringOutcome =
  | { response: MeteringResponse; record: MockUsageRecord | null }
  | { refusal: { errorKey: ErrorKey; message: string } };

/**
 * Mirrors the transaction of MeteringService.consume, after its input checks:
 * a replay answers the first record, a plan with the capability of the meter
 * makes the use free, a balance that does not cover the units refuses it, and
 * otherwise the record is stored and the units are taken.
 */
export function consumeCredits(
  customerId: string,
  use: MeteredUse
): MeteringOutcome {
  const { meterKey, units, idempotencyKey, occurredAt, requestedOccurredAt } =
    use;
  const state = getState();
  const balanceUnits =
    state.billingCreditBalances.get(customerId)?.balanceUnits ?? 0;
  const existing = state.billingUsageRecords
    .values()
    .find(
      (r) => r.customerId === customerId && r.idempotencyKey === idempotencyKey
    );

  if (existing) {
    const sameTime =
      requestedOccurredAt === undefined ||
      new Date(requestedOccurredAt).getTime() ===
        new Date(existing.occurredAt).getTime();

    if (
      existing.meterKey !== meterKey ||
      existing.quantity !== units ||
      !sameTime
    ) {
      return {
        refusal: {
          errorKey: ErrorKeys.BILLING.USAGE_KEY_REUSED,
          message:
            'This idempotency key was already used for another usage record.'
        }
      };
    }

    return {
      response: {
        recordId: existing.id,
        debited: true,
        replayed: true,
        balanceAfter: balanceUnits
      },
      record: null
    };
  }

  if (subscriptionPlan(customerId)?.entitlements.includes(METERS[meterKey])) {
    return {
      response: {
        recordId: null,
        debited: false,
        replayed: false,
        balanceAfter: balanceUnits
      },
      record: null
    };
  }

  if (balanceUnits < units) {
    return {
      refusal: {
        errorKey: ErrorKeys.BILLING.INSUFFICIENT_CREDITS,
        message: 'There are not enough credits for this use. Top up credits.'
      }
    };
  }

  const record: MockUsageRecord = {
    id: randomUUID(),
    customerId,
    subscriptionId: null,
    meterKey,
    quantity: units,
    occurredAt,
    idempotencyKey,
    recordedAt: new Date().toISOString()
  };

  state.billingUsageRecords.set(record.id, record);
  const change = applyCreditDelta(customerId, -units);

  // The server emits CreditBalanceCrossedEvent here.
  if (crossesZero(change)) notifyEntitlementsChanged(customerId);

  return {
    response: {
      recordId: record.id,
      debited: true,
      replayed: false,
      balanceAfter: change.after
    },
    record
  };
}

/** Mirrors CreditService.spentOnMetering for the current calendar month (UTC). */
export function unitsSpentThisMonth(customerId: string): {
  periodStart: Date;
  periodEnd: Date;
  unitsSpent: number;
} {
  const now = new Date();
  const periodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const periodEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  );
  // The server sums the ledger; each record is one debit of its quantity.
  const unitsSpent = getState()
    .billingUsageRecords.values()
    .filter((r) => {
      const recordedAt = Date.parse(r.recordedAt);

      return (
        r.customerId === customerId &&
        recordedAt >= periodStart.getTime() &&
        recordedAt < periodEnd.getTime()
      );
    })
    .reduce((sum, r) => sum + r.quantity, 0);

  return { periodStart, periodEnd, unitsSpent };
}
