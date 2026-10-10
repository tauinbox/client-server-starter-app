import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { FeatureFlag } from '../src/modules/feature-flags/entities/feature-flag.entity';
import { FeatureFlagService } from '../src/modules/feature-flags/services/feature-flag.service';
import { flagAuditActor } from './flag-audit-actor';
import { FeatureFlagResolverService } from '../src/modules/feature-flags/services/feature-flag-resolver.service';
import { MailService } from '../src/modules/mail/mail.service';
import { User } from '../src/modules/users/entities/user.entity';
import { UsersService } from '../src/modules/users/services/users.service';

// A flag gate reads the user attributes as they are now: a change of email
// moves the user out of an email-domain rule on the next check.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Feature-flag gate sees a changed user attribute (e2e)', () => {
  const tag = `flag-attr-fresh-${Date.now()}`;
  const domainA = `${tag}-a.example.com`;
  const domainB = `${tag}-b.example.com`;
  const key = `${tag}-flag`;

  let app: INestApplication;
  let dataSource: DataSource;
  let userId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);

    jest
      .spyOn(app.get(MailService), 'sendEmailVerification')
      .mockResolvedValue(undefined);

    const userRepository = dataSource.getRepository(User);
    const user = await userRepository.save(
      userRepository.create({
        email: `holder@${domainA}`,
        firstName: 'Flag',
        lastName: 'Holder',
        isEmailVerified: true,
        password: null
      })
    );
    userId = user.id;
  }, 60000);

  afterAll(async () => {
    jest.restoreAllMocks();
    if (dataSource) {
      await dataSource.getRepository(FeatureFlag).delete({ key });
      await dataSource.getRepository(User).delete({ id: userId });
    }
    await app?.close();
  });

  it('closes an email-domain gate as soon as the email leaves the domain', async () => {
    await app.get(FeatureFlagService).create(
      {
        key,
        enabled: true,
        rules: [
          {
            effect: 'include',
            payload: {
              type: 'attribute',
              field: 'emailDomain',
              op: 'eq',
              value: domainA
            }
          }
        ]
      },
      flagAuditActor()
    );
    const resolver = app.get(FeatureFlagResolverService);
    await resolver.invalidateAll();

    expect(await resolver.isEnabledForUserId(userId, key)).toBe(true);

    await app
      .get(UsersService)
      .update(userId, { email: `holder@${domainB}` }, SYSTEM_ABILITY);

    expect(await resolver.isEnabledForUserId(userId, key)).toBe(false);
  });
});
