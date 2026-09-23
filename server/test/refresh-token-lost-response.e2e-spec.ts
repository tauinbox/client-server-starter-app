import { randomUUID } from 'crypto';
import { HttpException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { RefreshTokenService } from '../src/modules/auth/services/refresh-token.service';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { REFRESH_REUSE_GRACE_MS } from '@app/shared/constants';

// The grace check compares `created_at` values in SQL, so only a real Postgres
// proves it. Runs only when DB_HOST is set: CI provides Postgres, a bare local
// run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Refresh token lost-response replay (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let refreshTokenService: RefreshTokenService;
  let auditSpy: jest.SpyInstance<
    void,
    Parameters<AuditService['logFireAndForget']>
  >;
  const email = `lost-response-${Date.now()}@example.com`;
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

    auditSpy = jest
      .spyOn(app.get(AuditService), 'logFireAndForget')
      .mockImplementation(() => undefined);

    const user = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email,
        firstName: 'Lost',
        lastName: 'Response',
        password: null
      })
    );
    userId = user.id;
  }, 60000);

  beforeEach(async () => {
    auditSpy.mockClear();
    await dataSource.getRepository(RefreshToken).delete({ userId });
    await dataSource
      .getRepository(User)
      .update(userId, { tokenRevokedAt: null });
  });

  afterAll(async () => {
    await dataSource?.getRepository(User).delete({ email });
    await app?.close();
  });

  async function seedSession(): Promise<{ raw: string; sessionId: string }> {
    const raw = `raw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const sessionId = randomUUID();
    await refreshTokenService.createRefreshToken(
      userId,
      raw,
      3600,
      sessionId,
      null
    );
    return { raw, sessionId };
  }

  async function errorKeyOf(call: Promise<unknown>): Promise<unknown> {
    try {
      await call;
    } catch (err) {
      return (err as HttpException).getResponse();
    }
    return 'RESOLVED';
  }

  async function rowsOf(sessionId: string): Promise<number> {
    return dataSource.getRepository(RefreshToken).count({
      where: { sessionId }
    });
  }

  async function tokenRevokedAt(): Promise<Date | null> {
    const user = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: userId });
    return user.tokenRevokedAt;
  }

  function auditActions(): AuditAction[] {
    return auditSpy.mock.calls.map((call) => call[0].action);
  }

  it('ends only the replayed session inside the window and leaves the other device signed in', async () => {
    const deviceA = await seedSession();
    const deviceB = await seedSession();

    await authService.refreshTokens(deviceA.raw);

    expect(await errorKeyOf(authService.refreshTokens(deviceA.raw))).toEqual(
      expect.objectContaining({ errorKey: 'errors.auth.invalidRefreshToken' })
    );

    expect(await rowsOf(deviceA.sessionId)).toBe(0);
    expect(await rowsOf(deviceB.sessionId)).toBe(1);
    expect(await tokenRevokedAt()).toBeNull();
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.TOKEN_REFRESH_FAILURE,
        details: { reason: 'predecessor_replay_in_grace' }
      })
    );
    expect(auditActions()).not.toContain(AuditAction.TOKEN_REUSE_DETECTED);

    const { tokens } = await authService.refreshTokens(deviceB.raw);
    expect(tokens.refresh_token).toBeTruthy();
  }, 30000);

  it('purges every session when the replay arrives after the window', async () => {
    const deviceA = await seedSession();
    const deviceB = await seedSession();

    await authService.refreshTokens(deviceA.raw);
    // Both rows of the chain move back together, so their order is kept.
    await dataSource.query(
      `UPDATE refresh_tokens SET created_at = created_at - ($1 * INTERVAL '1 millisecond') WHERE session_id = $2`,
      [REFRESH_REUSE_GRACE_MS + 1000, deviceA.sessionId]
    );

    await errorKeyOf(authService.refreshTokens(deviceA.raw));

    expect(await rowsOf(deviceA.sessionId)).toBe(0);
    expect(await rowsOf(deviceB.sessionId)).toBe(0);
    expect(await tokenRevokedAt()).toBeInstanceOf(Date);
    expect(auditActions()).toContain(AuditAction.TOKEN_REUSE_DETECTED);
  }, 30000);

  it('purges every session when an older ancestor is replayed', async () => {
    const deviceA = await seedSession();
    const deviceB = await seedSession();

    const first = await authService.refreshTokens(deviceA.raw);
    await authService.refreshTokens(first.tokens.refresh_token);

    await errorKeyOf(authService.refreshTokens(deviceA.raw));

    expect(await rowsOf(deviceA.sessionId)).toBe(0);
    expect(await rowsOf(deviceB.sessionId)).toBe(0);
    expect(await tokenRevokedAt()).toBeInstanceOf(Date);
    expect(auditActions()).toContain(AuditAction.TOKEN_REUSE_DETECTED);
  }, 30000);

  it('purges every session when the replayed token has no successor', async () => {
    const deviceA = await seedSession();
    const deviceB = await seedSession();

    // A revocation without a rotation, as a deactivation leaves it.
    await dataSource
      .getRepository(RefreshToken)
      .update({ sessionId: deviceA.sessionId }, { revoked: true });

    await errorKeyOf(authService.refreshTokens(deviceA.raw));

    expect(await rowsOf(deviceB.sessionId)).toBe(0);
    expect(await tokenRevokedAt()).toBeInstanceOf(Date);
    expect(auditActions()).toContain(AuditAction.TOKEN_REUSE_DETECTED);
  }, 30000);
});
