import { Seeder } from '@jorgebodega/typeorm-seeding';
import { DataSource } from 'typeorm';
import type {
  BillingProviderId,
  ProductGrant,
  ProductPrice,
  ProductType
} from '@app/shared/types';
import { Product } from '../modules/billing/entities/product.entity';

type SeedProduct = {
  key: string;
  name: string;
  description: string;
  type: ProductType;
  prices: Partial<Record<BillingProviderId, ProductPrice>>;
  grant: ProductGrant | null;
  active: boolean;
};

// Starter one-time catalog. A fixed-price sku that unlocks an
// entitlement for a limited period, a bounded custom-amount product
// (donation), and prepaid credit packs spent as metered usage. All values are
// illustrative defaults, editable here.
const PRODUCTS: SeedProduct[] = [
  {
    key: 'report-pack',
    name: 'Report pack',
    description: '30 days of reports access without a subscription',
    type: 'sku',
    prices: {
      yookassa: { currency: 'RUB', amountMinor: 49000 },
      paddle: { currency: 'USD', amountMinor: 500 }
    },
    grant: { entitlement: 'reports', durationDays: 30 },
    active: true
  },
  {
    key: 'donation',
    name: 'Donation',
    description: 'Support the project with any amount',
    type: 'custom',
    prices: {
      yookassa: {
        currency: 'RUB',
        minAmountMinor: 10000,
        maxAmountMinor: 5000000
      },
      paddle: { currency: 'USD', minAmountMinor: 100, maxAmountMinor: 50000 }
    },
    grant: null,
    active: true
  },
  {
    key: 'credits-500',
    name: '500 credits',
    description: '500 prepaid usage units',
    type: 'credits',
    prices: {
      yookassa: { currency: 'RUB', amountMinor: 50000 },
      paddle: { currency: 'USD', amountMinor: 500 }
    },
    grant: { credits: 500 },
    active: true
  },
  {
    key: 'credits-1000',
    name: '1000 credits',
    description: '1000 prepaid usage units at a better rate',
    type: 'credits',
    prices: {
      yookassa: { currency: 'RUB', amountMinor: 90000 },
      paddle: { currency: 'USD', amountMinor: 900 }
    },
    grant: { credits: 1000 },
    active: true
  },
  {
    key: 'credits-5000',
    name: '5000 credits',
    description: '5000 prepaid usage units at the best rate',
    type: 'credits',
    prices: {
      yookassa: { currency: 'RUB', amountMinor: 400000 },
      paddle: { currency: 'USD', amountMinor: 4000 }
    },
    grant: { credits: 5000 },
    active: true
  }
];

export default class BillingProductsSeeder extends Seeder {
  async run(dataSource: DataSource): Promise<void> {
    const productRepo = dataSource.getRepository(Product);

    const existingKeys = new Set(
      (await productRepo.find()).map((product) => product.key)
    );
    const toCreate = PRODUCTS.filter(
      (product) => !existingKeys.has(product.key)
    );
    if (toCreate.length === 0) return;

    await productRepo.save(
      toCreate.map((product) => productRepo.create(product))
    );
  }
}
