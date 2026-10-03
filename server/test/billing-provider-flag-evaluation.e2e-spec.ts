import { randomUUID } from 'node:crypto';
import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, Repository } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { BillingService } from '../src/modules/billing/billing.service';
import { FeatureFlag } from '../src/modules/feature-flags/entities/feature-flag.entity';
import { FeatureFlagResolverService } from '../src/modules/feature-flags/services/feature-flag-resolver.service';

// The provider kill switch is evaluated in full: an environment that does not
// match refuses checkout even when the row is enabled.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const PADDLE_ENV = ['PADDLE_API_KEY', 'PADDLE_WEBHOOK_SECRET'] as const;

runWithInfra('Billing provider kill switch evaluation (e2e)', () => {
  let app: INestApplication;
  let flags: Repository<FeatureFlag>;
  let billing: BillingService;
  let resolver: FeatureFlagResolverService;
  let original: Pick<FeatureFlag, 'id' | 'enabled' | 'environments'>;
  const savedEnv = new Map<string, string | undefined>();
  const customer = {
    providerOverride: null,
    country: 'US',
    userId: randomUUID()
  };

  beforeAll(async () => {
    for (const name of PADDLE_ENV) {
      savedEnv.set(name, process.env[name]);
      process.env[name] = `e2e-${name}`;
    }

    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    flags = app.get(DataSource).getRepository(FeatureFlag);
    billing = app.get(BillingService);
    resolver = app.get(FeatureFlagResolverService);
    original = await flags.findOneByOrFail({ key: 'billing-paddle' });
  }, 60000);

  afterAll(async () => {
    if (original) {
      await flags.update(
        { id: original.id },
        { enabled: original.enabled, environments: original.environments }
      );
      await resolver.invalidateAll();
    }
    await app?.close();
    for (const [name, value] of savedEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  async function setKillSwitch(environments: string[]): Promise<void> {
    await flags.update({ id: original.id }, { enabled: true, environments });
    await resolver.invalidateAll();
  }

  it('refuses checkout when the enabled flag targets another environment', async () => {
    await setKillSwitch(['e2e-no-such-environment']);

    await expect(billing.resolveProvider(customer)).rejects.toThrow(
      ServiceUnavailableException
    );
    await expect(
      billing.isProviderAvailable('paddle', customer.userId)
    ).resolves.toBe(false);
  });

  it('resolves the provider when the flag matches the environment', async () => {
    await setKillSwitch([]);

    await expect(billing.resolveProvider(customer)).resolves.toMatchObject({
      id: 'paddle'
    });
    await expect(
      billing.isProviderAvailable('paddle', customer.userId)
    ).resolves.toBe(true);
  });
});
