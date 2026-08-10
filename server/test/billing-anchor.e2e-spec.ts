import { DataSource } from 'typeorm';
import { postgresConfig } from '../src/postgres.config';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('subscription billing anchor (e2e)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
  }, 30000);

  afterAll(async () => {
    await ds?.destroy();
  });

  /** A customer plus the ids needed to hang a subscription off it. */
  async function seedCustomer(
    runner: ReturnType<DataSource['createQueryRunner']>,
    stamp: number
  ): Promise<string> {
    const [{ id: userId }] = (await runner.query(
      `INSERT INTO users (email, "firstName", "lastName")
       VALUES ($1, $2, $3) RETURNING id`,
      [`anchor-${stamp}@example.com`, 'An', 'Chor']
    )) as Array<{ id: string }>;
    const [{ id: customerId }] = (await runner.query(
      `INSERT INTO billing_customers (user_id, provider, country, currency)
       VALUES ($1, 'yookassa', 'RU', 'RUB') RETURNING id`,
      [userId]
    )) as Array<{ id: string }>;
    return customerId;
  }

  it('round-trips billingAnchorAt through the entity mapping', async () => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const customerId = await seedCustomer(runner, Date.now());
      const anchor = new Date('2025-12-31T10:00:00.000Z');
      const repo = runner.manager.getRepository(Subscription);

      const saved = await repo.save(
        repo.create({
          customerId,
          planKey: 'pro',
          provider: 'yookassa',
          billingMode: 'fixed',
          status: 'active',
          lifecycleOwner: 'self',
          currentPeriodStart: anchor,
          currentPeriodEnd: new Date('2026-01-31T10:00:00.000Z'),
          billingAnchorAt: anchor,
          cancelAtPeriodEnd: false,
          trialEnd: null,
          providerSubscriptionId: null,
          paymentMethodId: null
        })
      );

      // The renewal advance writes the anchor through the same criteria-based
      // update, which is where a wrong column name would surface.
      const moved = new Date('2026-02-28T10:00:00.000Z');
      const updated = await repo.update(
        { id: saved.id },
        { billingAnchorAt: anchor, currentPeriodEnd: moved }
      );
      expect(updated.affected).toBe(1);

      const [row] = (await runner.query(
        `SELECT billing_anchor_at FROM subscriptions WHERE id = $1`,
        [saved.id]
      )) as Array<{ billing_anchor_at: Date }>;
      expect(new Date(row.billing_anchor_at).toISOString()).toBe(
        anchor.toISOString()
      );

      const reread = await repo.findOne({ where: { id: saved.id } });
      expect(reread?.billingAnchorAt?.toISOString()).toBe(anchor.toISOString());
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('leaves the anchor nullable for provider-managed rows', async () => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const customerId = await seedCustomer(runner, Date.now() + 1);
      const [{ id }] = (await runner.query(
        `INSERT INTO subscriptions
           (customer_id, plan_key, provider, billing_mode, status,
            lifecycle_owner, current_period_start, current_period_end)
         VALUES ($1, 'pro', 'paddle', 'fixed', 'active', 'provider', now(), now() + interval '30 days')
         RETURNING id`,
        [customerId]
      )) as Array<{ id: string }>;

      const reread = await runner.manager
        .getRepository(Subscription)
        .findOne({ where: { id } });
      expect(reread?.billingAnchorAt).toBeNull();
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
