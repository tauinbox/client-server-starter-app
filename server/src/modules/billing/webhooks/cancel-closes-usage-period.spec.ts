import { Test } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Customer } from '../entities/customer.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { BILLING_PROVIDERS } from '../providers/payment-provider.interface';
import { UsageRating } from '../rating/usage-rating.strategy';
import { CreditService } from '../services/credit.service';
import { UsageInvoicingService } from '../services/usage-invoicing.service';
import { BillingEventReducer } from './billing-event-reducer.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import type { NormalizedEvent } from '../providers/payment-provider.interface';

const PERIOD_START = new Date('2026-05-01T00:00:00Z');
const PERIOD_END = new Date('2026-06-01T00:00:00Z');

/**
 * The reducer emits after commit and `UsageInvoicingService` swallows its own
 * errors, so a wiring mistake between them fails silently. These two are wired
 * through a REAL `EventEmitter2` for exactly that reason: a mocked `emit`
 * proves the call, not that anything is listening.
 */
async function build() {
  const storedSubscription = {
    id: 'sub-1',
    customerId: 'cust-1',
    planKey: 'usage',
    provider: 'paddle',
    billingMode: 'usage',
    lifecycleOwner: 'provider',
    status: 'active',
    providerSubscriptionId: 'psub_1',
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END
  } as Subscription;

  const insertedInvoices: Array<Record<string, unknown>> = [];
  const manager = {
    save: jest.fn((entity: { id?: string }) => Promise.resolve(entity)),
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    findOne: jest.fn((entity: unknown) =>
      Promise.resolve(entity === Subscription ? storedSubscription : null)
    ),
    createQueryBuilder: () => {
      const builder = {
        insert: () => builder,
        into: () => builder,
        values: (v: Record<string, unknown>) => {
          insertedInvoices.push(v);
          return builder;
        },
        orIgnore: () => builder,
        returning: () => builder,
        execute: () => Promise.resolve({ raw: [{ id: 'inv-1' }] })
      };
      return builder;
    }
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
    manager
  };
  const chargeUsage = jest.fn().mockResolvedValue(undefined);

  const moduleRef = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot()],
    providers: [
      BillingEventReducer,
      {
        provide: MetricsService,
        useValue: { recordUnmatchedOffSessionCharge: jest.fn() }
      },
      UsageInvoicingService,
      { provide: getDataSourceToken(), useValue: dataSource },
      {
        provide: getRepositoryToken(Subscription),
        useValue: { findOne: jest.fn().mockResolvedValue(storedSubscription) }
      },
      {
        provide: getRepositoryToken(Customer),
        useValue: {
          findOne: jest
            .fn()
            .mockResolvedValue({ id: 'cust-1', userId: 'user-1' })
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
      { provide: BILLING_PROVIDERS, useValue: [{ id: 'paddle', chargeUsage }] },
      {
        provide: UsageRating,
        useValue: {
          summarizeForPeriodWithCredits: jest.fn().mockResolvedValue({
            amountMinor: 8400,
            creditUnitsApplied: 0,
            currency: 'USD',
            receiptItems: [
              {
                description: 'Pay as you go: api_calls × 42',
                amountMinor: 8400,
                quantity: 1
              }
            ]
          })
        }
      },
      {
        provide: CreditService,
        useValue: {
          availableUnitsForUpdate: jest.fn().mockResolvedValue(0),
          spendOnUsage: jest.fn().mockResolvedValue(undefined),
          addPurchase: jest.fn().mockResolvedValue(undefined)
        }
      }
    ]
  }).compile();
  await moduleRef.init();

  return {
    reducer: moduleRef.get(BillingEventReducer),
    chargeUsage,
    insertedInvoices,
    close: () => moduleRef.close()
  };
}

const canceledEvent: NormalizedEvent = {
  provider: 'paddle',
  providerEventId: 'evt_cancel',
  type: 'subscription.canceled',
  payload: {
    ref: { customerId: 'cust-1', userId: 'user-1' },
    providerSubscriptionId: 'psub_1',
    status: 'canceled',
    planKey: 'usage',
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialEnd: null
  }
};

describe('a provider-managed cancel closes and charges the metered period', () => {
  it('reaches the usage-invoicing listener over the real event bus', async () => {
    const ctx = await build();

    await ctx.reducer.reduce(canceledEvent);
    // The listener runs on the emit's microtask chain, not inside the reduce.
    await new Promise((resolve) => setImmediate(resolve));

    expect(ctx.chargeUsage).toHaveBeenCalledWith(
      'psub_1',
      8400,
      'USD',
      'Pay as you go: api_calls × 42',
      `usage:sub-1:${PERIOD_END.getTime()}`
    );
    expect(ctx.insertedInvoices).toContainEqual(
      expect.objectContaining({
        providerEventId: `usage:sub-1:${PERIOD_END.getTime()}`,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        status: 'pending'
      })
    );
    await ctx.close();
  });
});
