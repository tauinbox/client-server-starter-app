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

// The rotation cut-off compares a stored `created_at`, and the reuse detector
// reads the rows the refusal leaves behind, so only a real Postgres proves it.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Refresh token refused for key rotation (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let refreshTokenService: RefreshTokenService;
  let auditSpy: jest.SpyInstance<
    void,
    Parameters<AuditService['logFireAndForget']>
  >;
  const email = `key-rotation-${Date.now()}@example.com`;
  const previousMinIat = process.env['JWT_MIN_IAT'];
  const minIat = Math.floor(Date.now() / 1000) - 60;
  let userId: string;

  beforeAll(async () => {
    process.env['JWT_MIN_IAT'] = String(minIat);

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
        firstName: 'Key',
        lastName: 'Rotation',
        password: null
      })
    );
    userId = user.id;
  }, 60000);

  afterAll(async () => {
    await dataSource?.getRepository(User).delete({ email });
    await app?.close();
    if (previousMinIat === undefined) {
      delete process.env['JWT_MIN_IAT'];
    } else {
      process.env['JWT_MIN_IAT'] = previousMinIat;
    }
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

  it('ends only the pre-rotation session and treats a second presentation as an unknown token', async () => {
    const preRotation = await seedSession();
    await dataSource.query(
      `UPDATE refresh_tokens SET created_at = to_timestamp($1) WHERE session_id = $2`,
      [minIat - 600, preRotation.sessionId]
    );
    // A sign-in on another device after the rotation.
    const postRotation = await seedSession();

    expect(
      await errorKeyOf(authService.refreshTokens(preRotation.raw))
    ).toEqual(
      expect.objectContaining({ errorKey: 'errors.auth.sessionInvalidated' })
    );
    expect(
      await errorKeyOf(authService.refreshTokens(preRotation.raw))
    ).toEqual(
      expect.objectContaining({ errorKey: 'errors.auth.invalidRefreshToken' })
    );

    expect(await rowsOf(preRotation.sessionId)).toBe(0);
    expect(await rowsOf(postRotation.sessionId)).toBe(1);
    const user = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: userId });
    expect(user.tokenRevokedAt).toBeNull();
    expect(auditSpy.mock.calls.map((call) => call[0].action)).not.toContain(
      AuditAction.TOKEN_REUSE_DETECTED
    );

    const { tokens } = await authService.refreshTokens(postRotation.raw);
    expect(tokens.refresh_token).toBeTruthy();
  }, 30000);
});
