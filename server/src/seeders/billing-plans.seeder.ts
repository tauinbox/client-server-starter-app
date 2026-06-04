import { Seeder } from '@jorgebodega/typeorm-seeding';
import { DataSource } from 'typeorm';
import type {
  BillingMode,
  BillingProviderId,
  PlanInterval,
  PlanPrice
} from '@app/shared/types';
import { Plan } from '../modules/billing/entities/plan.entity';

type SeedPlan = {
  key: string;
  name: string;
  description: string;
  billingMode: BillingMode;
  interval: PlanInterval;
  meterKey: string | null;
  entitlements: string[];
  limits: Record<string, number> | null;
  trialDays: number;
  active: boolean;
  prices: Partial<Record<BillingProviderId, PlanPrice>>;
};

// Starter catalog (design §17.1). Two prices per tier — RUB charged via YooKassa,
// USD via Paddle — keyed by provider; the resolved billing region selects which
// is shown/charged. Money is in minor units. The `usage` plan ships inactive so a
// non-functional tier is never exposed until the usage subsystem (M2) activates
// it. All values are illustrative defaults, editable here.
const PLANS: SeedPlan[] = [
  {
    key: 'free',
    name: 'Free',
    description: 'Core access at no cost',
    billingMode: 'fixed',
    interval: 'month',
    meterKey: null,
    entitlements: [],
    limits: null,
    trialDays: 0,
    active: true,
    prices: {
      yookassa: { currency: 'RUB', amountMinor: 0 },
      paddle: { currency: 'USD', amountMinor: 0 }
    }
  },
  {
    key: 'pro',
    name: 'Pro',
    description: 'For growing teams',
    billingMode: 'fixed',
    interval: 'month',
    meterKey: null,
    entitlements: ['reports', 'api-access', 'data-export'],
    limits: { records: 10000 },
    trialDays: 0,
    active: true,
    prices: {
      yookassa: { currency: 'RUB', amountMinor: 99000 },
      paddle: { currency: 'USD', amountMinor: 1200 }
    }
  },
  {
    key: 'business',
    name: 'Business',
    description: 'Advanced limits and priority support',
    billingMode: 'fixed',
    interval: 'month',
    meterKey: null,
    entitlements: ['reports', 'api-access', 'data-export', 'priority-support'],
    limits: { records: 100000 },
    trialDays: 0,
    active: true,
    prices: {
      yookassa: { currency: 'RUB', amountMinor: 290000 },
      paddle: { currency: 'USD', amountMinor: 2900 }
    }
  },
  {
    key: 'usage',
    name: 'Pay as you go',
    description: 'Pay only for what you use',
    billingMode: 'usage',
    interval: 'month',
    meterKey: 'api_calls',
    entitlements: ['reports', 'api-access'],
    limits: null,
    trialDays: 0,
    active: false,
    prices: {
      yookassa: {
        currency: 'RUB',
        amountMinor: 0,
        unitPriceMinor: 200,
        includedUnits: 0
      },
      paddle: {
        currency: 'USD',
        amountMinor: 0,
        unitPriceMinor: 2,
        includedUnits: 0
      }
    }
  }
];

export default class BillingPlansSeeder extends Seeder {
  async run(dataSource: DataSource): Promise<void> {
    const planRepo = dataSource.getRepository(Plan);

    const existingKeys = new Set(
      (await planRepo.find()).map((plan) => plan.key)
    );
    const toCreate = PLANS.filter((plan) => !existingKeys.has(plan.key));
    if (toCreate.length === 0) return;

    await planRepo.save(toCreate.map((plan) => planRepo.create(plan)));
  }
}
