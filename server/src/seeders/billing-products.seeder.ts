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

// Starter one-time catalog (design §20). A fixed-price sku that unlocks an
// entitlement for a limited period, and a bounded custom-amount product
// (donation). All values are illustrative defaults, editable here. Credit
// packs join this catalog with the credits subsystem.
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
