import { HttpException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'crypto';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { OAuthService } from '../src/modules/auth/services/oauth.service';
import { User } from '../src/modules/users/entities/user.entity';
import { hashToken } from '../src/common/utils/hash-token';
import { ErrorKeys } from '@app/shared/constants';
import type { OAuthUserProfile } from '../src/modules/auth/types/oauth-profile';

// A provider sign-up that took an address in flight would make the owner's
// confirmation fail on the email conflict. Skips without DB_HOST.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('A provider sign-up and a pending email change (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let oauthService: OAuthService;

  const emails: string[] = [];

  const errorKeyOf = async (run: Promise<unknown>): Promise<string> => {
    try {
      await run;
      return 'RESOLVED';
    } catch (error) {
      if (error instanceof HttpException) {
        const body = error.getResponse() as { errorKey?: string };
        return body.errorKey ?? `STATUS_${error.getStatus()}`;
      }
      throw error;
    }
  };

  const uniqueEmail = (label: string): string => {
    const email = `oauth-pending-${label}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@example.com`;
    emails.push(email);
    return email;
  };

  const vkProfile = (email: string): OAuthUserProfile => ({
    provider: 'vk',
    providerId: `vk-${crypto.randomBytes(6).toString('hex')}`,
    email,
    firstName: 'Provider',
    lastName: 'Signup',
    emailVerified: false
  });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    authService = app.get(AuthService);
    oauthService = app.get(OAuthService);
  }, 60000);

  afterAll(async () => {
    if (emails.length) {
      // oauth_accounts.user_id cascades on delete.
      await dataSource
        ?.getRepository(User)
        .delete(emails.map((e) => ({ email: e })));
    }
    await app?.close();
  });

  it('refuses the address while another account is changing to it, and the owner confirms', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const pendingEmail = uniqueEmail('target');
    const repository = dataSource.getRepository(User);
    const owner = await repository.save(
      repository.create({
        email: uniqueEmail('owner'),
        firstName: 'Pending',
        lastName: 'Owner',
        isEmailVerified: true,
        pendingEmail,
        pendingEmailToken: hashToken(rawToken),
        pendingEmailExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      })
    );

    expect(
      await errorKeyOf(
        oauthService.loginWithOAuth(vkProfile(pendingEmail), null)
      )
    ).toBe(ErrorKeys.AUTH.OAUTH_EMAIL_ALREADY_REGISTERED);
    expect(await repository.countBy({ email: pendingEmail })).toBe(0);

    // Pre-fix this confirmation threw the email conflict.
    expect(await errorKeyOf(authService.confirmEmailChange(rawToken))).toBe(
      'RESOLVED'
    );
    const confirmed = await repository.findOneByOrFail({ id: owner.id });
    expect(confirmed.email).toBe(pendingEmail);
    expect(confirmed.pendingEmail).toBeNull();
  }, 60000);

  it('still creates the account for an address that nobody holds', async () => {
    const email = uniqueEmail('free');

    const result = await oauthService.loginWithOAuth(
      {
        ...vkProfile(email),
        emailVerified: true
      },
      null
    );

    expect('mfaRequired' in result).toBe(false);
    expect(await dataSource.getRepository(User).countBy({ email })).toBe(1);
  }, 60000);
});
