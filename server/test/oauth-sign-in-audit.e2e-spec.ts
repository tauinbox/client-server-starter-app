import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  VersioningType
} from '@nestjs/common';
import { ApiValidationPipe } from '../src/common/pipes/api-validation.pipe';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as crypto from 'crypto';
import { Server } from 'http';
import { DataSource, In } from 'typeorm';
import { generateSync } from 'otplib';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { normalizeOtpCode } from '@app/shared/utils/otp-code';
import { SecretEncryptionService } from '../src/common/crypto/secret-encryption.service';
import { hashToken } from '../src/common/utils/hash-token';
import { requiresSecureCookies } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import { GoogleOAuthGuard } from '../src/modules/auth/guards/google-oauth.guard';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { OAuthAccount } from '../src/modules/auth/entities/oauth-account.entity';
import { User } from '../src/modules/users/entities/user.entity';
import type { OAuthUserProfile } from '../src/modules/auth/types/oauth-profile';
import { withPrivateThrottlerStorage } from './private-throttler';

// Only the Passport guard is replaced: every row is written after it or not at
// all. Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const RECOVERY_CODE = 'ABCDEFGH-IJKLMNOP';

runWithInfra('A provider sign-in writes audit rows (e2e)', () => {
  const previousKey = process.env['MFA_ENCRYPTION_KEY'];
  let app: INestApplication;
  let dataSource: DataSource;
  let oauthDataCookieName: string;
  let currentProfile: OAuthUserProfile;
  const emails: string[] = [];

  const stubGuard: CanActivate = {
    canActivate: (context: ExecutionContext): boolean => {
      context.switchToHttp().getRequest<{ user: OAuthUserProfile }>().user =
        currentProfile;

      return true;
    }
  };

  const newProfile = (): OAuthUserProfile => {
    const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const email = `oauth-audit-${stamp}@example.com`;

    emails.push(email);

    return {
      provider: 'google',
      providerId: `google-${stamp}`,
      email,
      name: 'Oauth Audit',
      emailVerified: true
    };
  };

  const callback = (requestId: string) =>
    request(app.getHttpServer() as Server)
      .get('/api/v1/auth/oauth/google/callback')
      .set('X-Request-Id', requestId)
      .expect(302);

  // The exchange issues the session and writes the success row, under its own
  // request id.
  const exchange = async (
    callbackResponse: request.Response,
    requestId: string
  ): Promise<request.Response> => {
    const header = callbackResponse.headers['set-cookie'] as
      string[] | string | undefined;
    const lines = Array.isArray(header) ? header : [header ?? ''];
    const oauthData = lines
      .find((line) => line.startsWith(`${oauthDataCookieName}=`))
      ?.split(';')[0];

    if (!oauthData) throw new Error('the callback set no oauth_data cookie');

    return request(app.getHttpServer() as Server)
      .post('/api/v1/auth/oauth/exchange')
      .set('X-Request-Id', requestId)
      .set('Cookie', oauthData)
      .expect(201);
  };

  const rowsFor = (requestId: string): Promise<AuditLog[]> =>
    dataSource
      .getRepository(AuditLog)
      .find({ where: { requestId }, order: { createdAt: 'ASC' } });

  // Polls until `expected` rows land, then waits one more interval so a row
  // written late would still be counted.
  const settledRows = async (
    requestId: string,
    expected: number
  ): Promise<AuditLog[]> => {
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await rowsFor(requestId)).length >= expected) break;

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    return rowsFor(requestId);
  };

  const linkedAccount = async (
    profile: OAuthUserProfile,
    fields: Partial<User>
  ): Promise<User> => {
    const user = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email: profile.email,
        name: profile.name,
        password: null,
        isEmailVerified: true,
        ...fields
      })
    );

    await dataSource.getRepository(OAuthAccount).save({
      userId: user.id,
      provider: profile.provider,
      providerId: profile.providerId
    });

    return user;
  };

  beforeAll(async () => {
    process.env['MFA_ENCRYPTION_KEY'] = crypto
      .randomBytes(32)
      .toString('base64');
    const moduleRef: TestingModule = await withPrivateThrottlerStorage(
      Test.createTestingModule({ imports: [CoreModule.forRoot()] })
    )
      .overrideGuard(GoogleOAuthGuard)
      .useValue(stubGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ApiValidationPipe());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();

    dataSource = app.get(DataSource);
    oauthDataCookieName = requiresSecureCookies(
      app.get(ConfigService).get<string>('ENVIRONMENT')
    )
      ? '__Host-oauth_data'
      : 'oauth_data';
  }, 60000);

  afterAll(async () => {
    if (previousKey === undefined) delete process.env['MFA_ENCRYPTION_KEY'];
    else process.env['MFA_ENCRYPTION_KEY'] = previousKey;

    if (emails.length) {
      const users = await dataSource
        ?.getRepository(User)
        .find({ where: { email: In(emails) } });
      const ids = users?.map((u) => u.id) ?? [];

      if (ids.length) {
        await dataSource.getRepository(AuditLog).delete({ actorId: In(ids) });
        // oauth_accounts.user_id and refresh_tokens.user_id cascade on delete.
        await dataSource.getRepository(User).delete({ id: In(ids) });
      }
    }

    await app?.close();
  });

  it('records a registration at the callback and a sign-in at the exchange for an account the provider creates', async () => {
    currentProfile = newProfile();
    const requestId = `oauth-audit-new-${crypto.randomUUID()}`;
    const exchangeId = `oauth-audit-new-exchange-${crypto.randomUUID()}`;

    const response = await callback(requestId);

    expect(response.headers['location']).toMatch(/\/oauth\/callback$/);
    await exchange(response, exchangeId);

    const user = await dataSource
      .getRepository(User)
      .findOneByOrFail({ email: currentProfile.email });
    const callbackRows = await settledRows(requestId, 1);

    expect(callbackRows).toHaveLength(1);
    expect(callbackRows[0].action).toBe(AuditAction.USER_REGISTER);
    expect(callbackRows[0].details).toEqual({ provider: 'google' });

    const exchangeRows = await settledRows(exchangeId, 1);

    expect(exchangeRows).toHaveLength(1);
    expect(exchangeRows[0].action).toBe(AuditAction.USER_LOGIN_SUCCESS);
    expect(exchangeRows[0].details).toEqual({
      method: 'oauth',
      provider: 'google'
    });

    for (const row of [...callbackRows, ...exchangeRows]) {
      expect(row.actorId).toBe(user.id);
      expect(row.ipAddress).toBeTruthy();
    }
  });

  it('records only a sign-in, at the exchange, for an identity that is already linked', async () => {
    currentProfile = newProfile();
    const user = await linkedAccount(currentProfile, {});
    const requestId = `oauth-audit-linked-${crypto.randomUUID()}`;
    const exchangeId = `oauth-audit-linked-exchange-${crypto.randomUUID()}`;

    await exchange(await callback(requestId), exchangeId);

    expect(await settledRows(requestId, 0)).toEqual([]);
    const rows = await settledRows(exchangeId, 1);

    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(AuditAction.USER_LOGIN_SUCCESS);
    expect(rows[0].actorId).toBe(user.id);
  });

  // POST /auth/mfa/verify writes the success row when the challenge is met.
  it('records no sign-in when the answer is a second-factor challenge', async () => {
    currentProfile = newProfile();
    await linkedAccount(currentProfile, { totpEnabledAt: new Date() });
    const requestId = `oauth-audit-mfa-${crypto.randomUUID()}`;

    const response = await callback(requestId);

    expect(response.headers['location']).toMatch(/\/oauth\/callback$/);

    expect(await settledRows(requestId, 0)).toEqual([]);
  });

  // The pending token carries the provider, so the row of the finished
  // sign-in names it as the exchange row of an account with no factor does.
  it.each([
    {
      route: 'verify',
      body: (mfaToken: string) => ({
        mfaToken,
        code: generateSync({ secret: TOTP_SECRET })
      })
    },
    {
      route: 'recovery',
      body: (mfaToken: string) => ({ mfaToken, recoveryCode: RECOVERY_CODE })
    }
  ])(
    'records the provider in the sign-in row that POST /auth/mfa/$route writes',
    async ({ route, body }) => {
      currentProfile = newProfile();
      await linkedAccount(currentProfile, {
        totpSecret: app.get(SecretEncryptionService).encrypt(TOTP_SECRET),
        totpEnabledAt: new Date(),
        totpRecoveryCodes: [hashToken(normalizeOtpCode(RECOVERY_CODE))]
      });
      const exchangeId = `oauth-audit-mfa-exchange-${crypto.randomUUID()}`;
      const verifyId = `oauth-audit-mfa-${route}-${crypto.randomUUID()}`;

      const challenge = await exchange(
        await callback(`oauth-audit-mfa-cb-${crypto.randomUUID()}`),
        exchangeId
      );
      const { mfaRequired, mfaToken } = challenge.body as {
        mfaRequired: boolean;
        mfaToken: string;
      };

      expect(mfaRequired).toBe(true);

      await request(app.getHttpServer() as Server)
        .post(`/api/v1/auth/mfa/${route}`)
        .set('X-Request-Id', verifyId)
        .send(body(mfaToken))
        .expect(200);

      const rows = (await settledRows(verifyId, 1)).filter(
        ({ action }) => action === AuditAction.USER_LOGIN_SUCCESS
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].details).toEqual({
        factor: 'mfa',
        method: 'oauth',
        provider: 'google'
      });
    }
  );

  it.each([
    {
      state: 'a deactivated account',
      reason: 'account_deactivated',
      refuse: (user: User) =>
        dataSource.getRepository(User).update(user.id, { isActive: false })
    },
    {
      state: 'a soft-deleted owner of a linked identity',
      reason: 'account_not_found',
      refuse: (user: User) => dataSource.getRepository(User).softDelete(user.id)
    }
  ])(
    'records a failure with its reason for $state',
    async ({ reason, refuse }) => {
      currentProfile = newProfile();
      const user = await linkedAccount(currentProfile, {});

      await refuse(user);
      const requestId = `oauth-audit-refused-${crypto.randomUUID()}`;

      const response = await callback(requestId);

      expect(response.headers['location']).toMatch(
        /\/login\?oauth_error=auth_failed$/
      );

      const rows = await settledRows(requestId, 1);

      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe(AuditAction.USER_LOGIN_FAILURE);
      expect(rows[0].actorEmail).toBeNull();
      expect(rows[0].targetId).toBe(user.id);
      expect(rows[0].details).toEqual({
        method: 'oauth',
        provider: 'google',
        reason
      });
      await dataSource.getRepository(AuditLog).delete({ requestId });
    }
  );
});
