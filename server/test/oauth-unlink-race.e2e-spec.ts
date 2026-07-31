import { DataSource } from 'typeorm';
import { postgresConfig } from '../src/postgres.config';
import { OAuthAccountService } from '../src/modules/auth/services/oauth-account.service';
import { OAuthAccount } from '../src/modules/auth/entities/oauth-account.entity';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('OAuth unlink concurrency (e2e)', () => {
  let ds: DataSource;
  let service: OAuthAccountService;
  let userId: string | undefined;

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
    service = new OAuthAccountService(ds.getRepository(OAuthAccount), ds);
  }, 30000);

  afterEach(async () => {
    if (userId) {
      // oauth_accounts.user_id cascades on delete.
      await ds.query(`DELETE FROM users WHERE id = $1`, [userId]);
      userId = undefined;
    }
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  async function seedPasswordlessUser(providers: string[]): Promise<string> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [{ id }] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO users (email, "firstName", "lastName", password)
       VALUES ($1, 'Race', 'Unlink', NULL) RETURNING id`,
      [`oauth-race-${stamp}@example.com`]
    );
    userId = id;

    for (const provider of providers) {
      await ds.query(
        `INSERT INTO oauth_accounts (provider, provider_id, user_id)
         VALUES ($1, $2, $3)`,
        [provider, `${provider}-${stamp}`, id]
      );
    }

    return id;
  }

  /**
   * Opening the second pooled connection costs more than a whole unlink
   * transaction takes, so on a cold pool the two requests run one after the
   * other and no test can observe the race. Warming both connections first is
   * what makes the interleaving reproducible.
   */
  async function warmPool(): Promise<void> {
    const runners = [ds.createQueryRunner(), ds.createQueryRunner()];
    await Promise.all(runners.map((r) => r.connect()));
    await Promise.all(runners.map((r) => r.release()));
  }

  it('leaves one login method when both providers are unlinked concurrently', async () => {
    const id = await seedPasswordlessUser(['google', 'facebook']);
    await warmPool();

    const outcomes = await Promise.allSettled([
      service.unlinkProvider(id, 'google'),
      service.unlinkProvider(id, 'facebook')
    ]);

    const remaining = await service.findByUserId(id);
    expect(remaining).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);

    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      status: 400
    });
  }, 30000);

  it('allows both unlinks concurrently once a password exists', async () => {
    const id = await seedPasswordlessUser(['google', 'facebook']);
    await ds.query(`UPDATE users SET password = 'hashed' WHERE id = $1`, [id]);
    await warmPool();

    const outcomes = await Promise.allSettled([
      service.unlinkProvider(id, 'google'),
      service.unlinkProvider(id, 'facebook')
    ]);

    expect(outcomes.every((o) => o.status === 'fulfilled')).toBe(true);
    expect(await service.findByUserId(id)).toHaveLength(0);
  }, 30000);
});
