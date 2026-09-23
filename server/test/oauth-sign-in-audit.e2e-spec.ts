import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as crypto from 'crypto';
import { Server } from 'http';
import { DataSource, In } from 'typeorm';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { ErrorKeys } from '@app/shared/constants';
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

runWithInfra('A provider sign-in writes audit rows (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
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
      firstName: 'Oauth',
      lastName: 'Audit',
      emailVerified: true
    };
  };

  const callback = (requestId: string) =>
    request(app.getHttpServer() as Server)
      .get('/api/v1/auth/oauth/google/callback')
      .set('X-Request-Id', requestId)
      .expect(302);

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
        firstName: profile.firstName,
        lastName: profile.lastName,
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
    const moduleRef: TestingModule = await withPrivateThrottlerStorage(
      Test.createTestingModule({ imports: [CoreModule.forRoot()] })
    )
      .overrideGuard(GoogleOAuthGuard)
      .useValue(stubGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true
      })
    );
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();

    dataSource = app.get(DataSource);
  }, 60000);

  afterAll(async () => {
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

  it('records a registration and a sign-in for an account the provider creates', async () => {
    currentProfile = newProfile();
    const requestId = `oauth-audit-new-${crypto.randomUUID()}`;

    const response = await callback(requestId);
    expect(response.headers['location']).toMatch(/\/oauth\/callback$/);

    const rows = await settledRows(requestId, 2);
    const user = await dataSource
      .getRepository(User)
      .findOneByOrFail({ email: currentProfile.email });
    expect(rows.map((r) => r.action).sort()).toEqual(
      [AuditAction.USER_LOGIN_SUCCESS, AuditAction.USER_REGISTER].sort()
    );
    for (const row of rows) {
      expect(row.actorId).toBe(user.id);
      expect(row.ipAddress).toBeTruthy();
    }
    expect(
      rows.find((r) => r.action === AuditAction.USER_LOGIN_SUCCESS)?.details
    ).toEqual({ method: 'oauth', provider: 'google' });
    expect(
      rows.find((r) => r.action === AuditAction.USER_REGISTER)?.details
    ).toEqual({ provider: 'google' });
  });

  it('records only a sign-in for an identity that is already linked', async () => {
    currentProfile = newProfile();
    const user = await linkedAccount(currentProfile, {});
    const requestId = `oauth-audit-linked-${crypto.randomUUID()}`;

    await callback(requestId);

    const rows = await settledRows(requestId, 1);
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

  it('records a failure with its reason for a deactivated account', async () => {
    currentProfile = newProfile();
    await linkedAccount(currentProfile, { isActive: false });
    const requestId = `oauth-audit-inactive-${crypto.randomUUID()}`;

    const response = await callback(requestId);
    expect(response.headers['location']).toMatch(
      /\/login\?oauth_error=auth_failed$/
    );

    const rows = await settledRows(requestId, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(AuditAction.USER_LOGIN_FAILURE);
    expect(rows[0].actorEmail).toBeNull();
    expect(rows[0].details).toEqual({
      method: 'oauth',
      provider: 'google',
      reason: ErrorKeys.AUTH.USER_DEACTIVATED
    });
    await dataSource.getRepository(AuditLog).delete({ requestId });
  });
});
