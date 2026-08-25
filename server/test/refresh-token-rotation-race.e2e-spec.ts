import { HttpException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { RefreshTokenService } from '../src/modules/auth/services/refresh-token.service';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { User } from '../src/modules/users/entities/user.entity';
import { AuditAction } from '@app/shared/enums/audit-action.enum';

// Only a real Postgres under READ COMMITTED produces the interleaving this
// covers: the refresh-token-reuse spec drives a synchronous in-memory
// repository where nothing can interleave.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Refresh token rotation race (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let refreshTokenService: RefreshTokenService;
  let auditSpy: jest.SpyInstance<
    void,
    Parameters<AuditService['logFireAndForget']>
  >;
  let metricsSpy: jest.SpyInstance<
    void,
    Parameters<MetricsService['recordAuthEvent']>
  >;
  const email = `rotation-race-${Date.now()}@example.com`;
  let userId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    authService = app.get(AuthService);
    refreshTokenService = app.get(RefreshTokenService);

    // Suppressed rather than read back from the table: the writes are
    // fire-and-forget, so asserting on their absence would race them.
    auditSpy = jest
      .spyOn(app.get(AuditService), 'logFireAndForget')
      .mockImplementation(() => undefined);
    metricsSpy = jest.spyOn(app.get(MetricsService), 'recordAuthEvent');

    const user = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email,
        firstName: 'Rotation',
        lastName: 'Race',
        password: null
      })
    );
    userId = user.id;
  }, 60000);

  beforeEach(async () => {
    auditSpy.mockClear();
    metricsSpy.mockClear();
    await dataSource.getRepository(RefreshToken).delete({ userId });
  });

  afterAll(async () => {
    await dataSource?.getRepository(User).delete({ email });
    await app?.close();
  });

  /**
   * Opening the second pooled connection costs more than the whole rotation
   * takes, so on a cold pool the two calls run one after the other, the second
   * reads an already-revoked token and takes the reuse-detection path instead
   * of the race path. Warming both connections is what makes the interleaving
   * reproducible.
   */
  async function warmPool(): Promise<void> {
    const runners = [
      dataSource.createQueryRunner(),
      dataSource.createQueryRunner()
    ];
    await Promise.all(runners.map((r) => r.connect()));
    await Promise.all(runners.map((r) => r.release()));
  }

  async function seedSession(): Promise<string> {
    const raw = `raw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await refreshTokenService.createRefreshToken(userId, raw, 3600);
    return raw;
  }

  it('gives one presented token exactly one live successor when rotated twice at once', async () => {
    const raw = await seedSession();
    await warmPool();

    const outcomes = await Promise.allSettled([
      authService.refreshTokens(raw),
      authService.refreshTokens(raw)
    ]);

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);

    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(rejected).toHaveLength(1);
    const reason = rejected[0].reason as HttpException;
    expect(reason.getStatus()).toBe(401);
    expect(reason.getResponse()).toMatchObject({
      errorKey: 'errors.auth.invalidRefreshToken'
    });

    const repository = dataSource.getRepository(RefreshToken);
    // Two rows total means the loser's INSERT rolled back with its throw.
    expect(await repository.count({ where: { userId, revoked: false } })).toBe(
      1
    );
    expect(await repository.count({ where: { userId } })).toBe(2);

    // Neither racer presented an already-revoked token, so the full reuse
    // detector must stay silent.
    const auditActions = auditSpy.mock.calls.map((call) => call[0].action);
    expect(auditActions).not.toContain(AuditAction.TOKEN_REUSE_DETECTED);

    const successes = metricsSpy.mock.calls.filter(
      (call) => call[0] === 'token_refresh_success'
    );
    expect(successes).toHaveLength(1);
  }, 30000);

  it('still rotates normally when the same token is presented only once', async () => {
    const raw = await seedSession();

    const { tokens } = await authService.refreshTokens(raw);
    expect(tokens.refresh_token).toBeTruthy();

    const repository = dataSource.getRepository(RefreshToken);
    expect(await repository.count({ where: { userId, revoked: false } })).toBe(
      1
    );
  }, 30000);
});
