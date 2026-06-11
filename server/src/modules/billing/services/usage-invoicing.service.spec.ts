import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Customer } from '../entities/customer.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import {
  InvoicePaidEvent,
  UsagePeriodClosedEvent
} from '../events/billing.events';
import { BILLING_PROVIDERS } from '../providers/payment-provider.interface';
import { UsageRating } from '../rating/usage-rating.strategy';
import { CreditService } from './credit.service';
import { UsageInvoicingService } from './usage-invoicing.service';

const PERIOD_START = new Date('2026-05-01T00:00:00Z');
const PERIOD_END = new Date('2026-06-01T00:00:00Z');
const CHARGE_KEY = `usage:sub-1:${PERIOD_END.getTime()}`;

const EVENT = new UsagePeriodClosedEvent(
  'user-1',
  'sub-1',
  PERIOD_START,
  PERIOD_END
);

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    customerId: 'cust-1',
    planKey: 'usage',
    provider: 'paddle',
    billingMode: 'usage',
    lifecycleOwner: 'provider',
    providerSubscriptionId: 'psub_1',
    ...overrides
  } as Subscription;
}

async function build(options: {
  subscription?: Subscription | null;
  insertRows?: Array<{ id: string }>;
  availableCredits?: number;
  summary?: Partial<{
    amountMinor: number;
    creditUnitsApplied: number;
    chargedUnits: number;
    currency: string;
    receiptItems: unknown[];
  }>;
}) {
  const subscription =
    options.subscription === undefined
      ? makeSubscription()
      : options.subscription;
  const summarizeForPeriodWithCredits = jest.fn().mockResolvedValue({
    totalUnits: 142,
    includedUnits: 100,
    billableUnits: 42,
    unitPriceMinor: 200,
    creditUnitsApplied: 0,
    chargedUnits: 42,
    amountMinor: 8400,
    currency: 'USD',
    receiptItems: [
      {
        description: 'Pay as you go: api_calls × 42',
        amountMinor: 8400,
        quantity: 1
      }
    ],
    ...options.summary
  });
  const chargeUsage = jest.fn().mockResolvedValue(undefined);
  const emit = jest.fn();
  const capturedValues: { value?: Record<string, unknown> } = {};
  const manager = {
    createQueryBuilder: () => {
      const builder = {
        insert: () => builder,
        into: () => builder,
        values: (v: Record<string, unknown>) => {
          capturedValues.value = v;
          return builder;
        },
        orIgnore: () => builder,
        returning: () => builder,
        execute: () =>
          Promise.resolve({ raw: options.insertRows ?? [{ id: 'inv-1' }] })
      };
      return builder;
    }
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager))
  };
  const credits = {
    availableUnits: jest.fn().mockResolvedValue(options.availableCredits ?? 0),
    spendOnUsage: jest.fn().mockResolvedValue(undefined)
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      UsageInvoicingService,
      {
        provide: getRepositoryToken(Subscription),
        useValue: { findOne: jest.fn().mockResolvedValue(subscription) }
      },
      {
        provide: getRepositoryToken(Customer),
        useValue: {
          findOne: jest.fn().mockResolvedValue({
            id: 'cust-1',
            userId: 'user-1',
            currency: 'USD'
          })
        }
      },
      {
        provide: getRepositoryToken(Plan),
        useValue: {
          findOne: jest
            .fn()
            .mockResolvedValue({ key: 'usage', name: 'Pay as you go' })
        }
      },
      { provide: getDataSourceToken(), useValue: dataSource },
      {
        provide: BILLING_PROVIDERS,
        useValue: [{ id: 'paddle', chargeUsage }]
      },
      { provide: UsageRating, useValue: { summarizeForPeriodWithCredits } },
      { provide: CreditService, useValue: credits },
      { provide: EventEmitter2, useValue: { emit } }
    ]
  }).compile();

  return {
    service: moduleRef.get(UsageInvoicingService),
    chargeUsage,
    summarizeForPeriodWithCredits,
    credits,
    emit,
    capturedValues
  };
}

describe('UsageInvoicingService', () => {
  it('plants a pending invoice for the closed period, then posts the provider charge', async () => {
    const {
      service,
      chargeUsage,
      summarizeForPeriodWithCredits,
      capturedValues,
      emit
    } = await build({});

    await service.handlePeriodClosed(EVENT);

    expect(summarizeForPeriodWithCredits).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sub-1' }),
      expect.objectContaining({ key: 'usage' }),
      { start: PERIOD_START, end: PERIOD_END },
      0
    );
    expect(capturedValues.value).toMatchObject({
      customerId: 'cust-1',
      subscriptionId: 'sub-1',
      provider: 'paddle',
      providerEventId: CHARGE_KEY,
      amountMinor: 8400,
      currency: 'USD',
      status: 'pending',
      billingMode: 'usage',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END
    });
    expect(chargeUsage).toHaveBeenCalledWith(
      'psub_1',
      8400,
      'USD',
      'Pay as you go: api_calls × 42',
      CHARGE_KEY
    );
    // The paid event comes from the provider webhook, never optimistically here.
    expect(emit).not.toHaveBeenCalled();
  });

  it('records a zero-usage close as a paid zero invoice without charging', async () => {
    const { service, chargeUsage, credits, capturedValues, emit } = await build(
      {
        summary: {
          amountMinor: 0,
          creditUnitsApplied: 0,
          chargedUnits: 0,
          receiptItems: []
        }
      }
    );

    await service.handlePeriodClosed(EVENT);

    expect(chargeUsage).not.toHaveBeenCalled();
    expect(credits.spendOnUsage).not.toHaveBeenCalled();
    expect(capturedValues.value).toMatchObject({
      amountMinor: 0,
      status: 'paid',
      providerInvoiceRef: CHARGE_KEY
    });
    expect(emit).toHaveBeenCalledWith(
      InvoicePaidEvent.name,
      expect.objectContaining({ userId: 'user-1', invoiceId: 'inv-1' })
    );
  });

  it('spends partial credits with the insert and charges only the remainder', async () => {
    const { service, chargeUsage, credits, capturedValues } = await build({
      availableCredits: 10,
      summary: {
        creditUnitsApplied: 10,
        chargedUnits: 32,
        amountMinor: 6400,
        receiptItems: [
          {
            description: 'Pay as you go: api_calls × 32',
            amountMinor: 6400,
            quantity: 1
          }
        ]
      }
    });

    await service.handlePeriodClosed(EVENT);

    expect(credits.spendOnUsage).toHaveBeenCalledWith(
      expect.anything(),
      'cust-1',
      'inv-1',
      10
    );
    expect(capturedValues.value).toMatchObject({
      amountMinor: 6400,
      status: 'pending'
    });
    expect(chargeUsage).toHaveBeenCalledWith(
      'psub_1',
      6400,
      'USD',
      'Pay as you go: api_calls × 32',
      CHARGE_KEY
    );
  });

  it('covers the whole period with credits: paid zero invoice, spend, no charge', async () => {
    const { service, chargeUsage, credits, capturedValues, emit } = await build(
      {
        availableCredits: 100,
        summary: {
          creditUnitsApplied: 42,
          chargedUnits: 0,
          amountMinor: 0,
          receiptItems: []
        }
      }
    );

    await service.handlePeriodClosed(EVENT);

    expect(chargeUsage).not.toHaveBeenCalled();
    expect(credits.spendOnUsage).toHaveBeenCalledWith(
      expect.anything(),
      'cust-1',
      'inv-1',
      42
    );
    expect(capturedValues.value).toMatchObject({
      amountMinor: 0,
      status: 'paid'
    });
    expect(emit).toHaveBeenCalledWith(
      InvoicePaidEvent.name,
      expect.objectContaining({ userId: 'user-1', invoiceId: 'inv-1' })
    );
  });

  it('never double-charges or double-spends: a lost insert race skips both', async () => {
    const { service, chargeUsage, credits } = await build({
      insertRows: [],
      availableCredits: 10,
      summary: { creditUnitsApplied: 10, chargedUnits: 32, amountMinor: 6400 }
    });

    await service.handlePeriodClosed(EVENT);

    expect(chargeUsage).not.toHaveBeenCalled();
    expect(credits.spendOnUsage).not.toHaveBeenCalled();
  });

  it('leaves the invoice pending and swallows a failed provider call', async () => {
    const { service, chargeUsage } = await build({});
    chargeUsage.mockRejectedValue(new Error('paddle down'));

    await expect(service.handlePeriodClosed(EVENT)).resolves.toBeUndefined();
  });

  it('skips when the subscription or its provider reference is gone', async () => {
    const { service, chargeUsage } = await build({ subscription: null });

    await service.handlePeriodClosed(EVENT);

    expect(chargeUsage).not.toHaveBeenCalled();
  });
});
