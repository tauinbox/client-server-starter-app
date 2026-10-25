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
import { JwtService } from '@nestjs/jwt';
import { MfaService } from '../src/modules/auth/services/mfa.service';
import { STEP_UP_OPERATION, TOKEN_PURPOSE } from '@app/shared/constants';

// The rotation cut-off compares a stored `created_at`, and the reuse detector
// reads the rows the refusal leaves behind, so only a real Postgres proves it.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Refresh token refused for key rotation (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let refreshTokenService: RefreshTokenService;
  let mfaService: MfaService;
  let jwtService: JwtService;
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
    mfaService = app.get(MfaService);
    jwtService = app.get(JwtService);

    auditSpy = jest
      .spyOn(app.get(AuditService), 'logFireAndForget')
      .mockImplementation(() => undefined);

    const user = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email,
        name: 'Key Rotation',
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
    await refreshTokenService.createRefreshToken(userId, raw, 3600, sessionId, {
      userAgent: null,
      ipAddress: null
    });
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
      await errorKeyOf(authService.refreshTokens(preRotation.raw, null))
    ).toEqual(
      expect.objectContaining({ errorKey: 'errors.auth.sessionInvalidated' })
    );
    expect(
      await errorKeyOf(authService.refreshTokens(preRotation.raw, null))
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

    const { tokens } = await authService.refreshTokens(postRotation.raw, null);
    expect(tokens.refresh_token).toBeTruthy();
  }, 30000);

  // jsonwebtoken keeps an `iat` given in the payload, so these mint a token
  // as it was issued before the cut-off. The fresh token beside each one shows
  // that the refusal comes from the cut-off and not from the token shape.
  function signIssuedAt(payload: object, iat: number): string {
    return jwtService.sign({ ...payload, iat }, { expiresIn: 3600 });
  }

  it('refuses a pending second-factor token issued before the cut-off', async () => {
    const mfaEmail = `key-rotation-mfa-${Date.now()}@example.com`;
    const mfaUser = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email: mfaEmail,
        name: 'Key Rotation',
        password: null,
        totpEnabledAt: new Date()
      })
    );
    const pending = { sub: mfaUser.id, purpose: TOKEN_PURPOSE.MFA_PENDING };

    try {
      expect(
        await errorKeyOf(
          mfaService.verifyChallenge(
            signIssuedAt(pending, minIat - 600),
            '000000'
          )
        )
      ).toEqual(
        expect.objectContaining({
          errorKey: 'errors.auth.mfaInvalidPendingToken'
        })
      );
      expect(
        await errorKeyOf(
          mfaService.verifyChallenge(
            signIssuedAt(pending, Math.floor(Date.now() / 1000)),
            '000000'
          )
        )
      ).toEqual(
        expect.objectContaining({ errorKey: 'errors.auth.mfaInvalidCode' })
      );
    } finally {
      await dataSource.getRepository(User).delete({ email: mfaEmail });
    }
  }, 30000);

  it('refuses a step-up proof issued before the cut-off', async () => {
    const user = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: userId });
    const proof = (iat: number): string =>
      signIssuedAt(
        {
          sub: userId,
          purpose: TOKEN_PURPOSE.REAUTH_PROOF,
          operation: STEP_UP_OPERATION.MFA_DISABLE,
          jti: randomUUID()
        },
        iat
      );

    expect(
      await errorKeyOf(
        authService.assertStepUp(
          user,
          undefined,
          proof(minIat - 600),
          STEP_UP_OPERATION.MFA_DISABLE
        )
      )
    ).toEqual(
      expect.objectContaining({ errorKey: 'errors.auth.reauthRequired' })
    );
    expect(
      await errorKeyOf(
        authService.assertStepUp(
          user,
          undefined,
          proof(Math.floor(Date.now() / 1000)),
          STEP_UP_OPERATION.MFA_DISABLE
        )
      )
    ).toBe('RESOLVED');
  }, 30000);
});
