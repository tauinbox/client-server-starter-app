import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { generateSync } from 'otplib';
import { ErrorKeys } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import { SecretEncryptionService } from '../src/common/crypto/secret-encryption.service';
import { MfaService } from '../src/modules/auth/services/mfa.service';
import { User } from '../src/modules/users/entities/user.entity';

// Each write of the factor holds only while the state it was checked against
// still holds. The caller's copy of the row can be stale: another request may
// have set up, turned on or cleared the factor since it was read.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

runWithInfra('Conditional writes of the second factor (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let mfaService: MfaService;
  const previousKey = process.env['MFA_ENCRYPTION_KEY'];
  const stamp = Date.now();
  const emails: string[] = [];

  beforeAll(async () => {
    process.env['MFA_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    mfaService = app.get(MfaService);
  }, 60000);

  afterAll(async () => {
    if (previousKey === undefined) delete process.env['MFA_ENCRYPTION_KEY'];
    else process.env['MFA_ENCRYPTION_KEY'] = previousKey;
    for (const email of emails) {
      await dataSource?.getRepository(User).delete({ email });
    }
    await app?.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function createAccount(tag: string, enrolled: boolean): Promise<User> {
    const email = `mfa-writes-${tag}-${stamp}@example.com`;
    emails.push(email);
    const repository = dataSource.getRepository(User);
    return repository.save(
      repository.create({
        email,
        name: 'Mfa Writes',
        password: null,
        isEmailVerified: true,
        totpSecret: enrolled
          ? app.get(SecretEncryptionService).encrypt(SECRET)
          : null,
        totpEnabledAt: enrolled ? new Date() : null,
        totpRecoveryCodes: enrolled ? ['spent-hash'] : null
      })
    );
  }

  function reload(id: string): Promise<User> {
    return dataSource.getRepository(User).findOneOrFail({ where: { id } });
  }

  const notEnabled = {
    status: 409,
    response: { errorKey: ErrorKeys.AUTH.MFA_NOT_ENABLED }
  };

  it('turns the factor on with the secret the code proved while a second setup races it', async () => {
    const user = await createAccount('enable-race', false);
    const { secret } = await mfaService.beginEnrolment(user);
    const pending = await reload(user.id);

    // The second setup starts when the enable write arrives. Under the row
    // lock of the code check it waits; with no lock it lands first.
    let racing: Promise<unknown> | undefined;
    const update = EntityManager.prototype.update;
    jest
      .spyOn(EntityManager.prototype, 'update')
      .mockImplementation(async function (
        this: EntityManager,
        ...args: Parameters<EntityManager['update']>
      ) {
        const changes = args[2] as { totpEnabledAt?: unknown };
        if (racing === undefined && changes.totpEnabledAt instanceof Date) {
          racing = mfaService.beginEnrolment(user);
          await Promise.race([
            racing.catch(() => undefined),
            new Promise((resolve) => setTimeout(resolve, 500))
          ]);
        }
        return update.apply(this, args);
      });

    await mfaService.completeEnrolment(pending, generateSync({ secret }));

    await expect(racing).rejects.toMatchObject({
      status: 409,
      response: { errorKey: ErrorKeys.AUTH.MFA_ALREADY_ENABLED }
    });
    const after = await reload(user.id);
    expect(after.totpEnabledAt).not.toBeNull();
    expect(after.totpSecret).toBe(pending.totpSecret);
  }, 30000);

  it('refuses a setup read before the factor was turned on, and leaves the factor on', async () => {
    const stale = await createAccount('begin-stale', false);
    await dataSource.getRepository(User).update(stale.id, {
      totpSecret: app.get(SecretEncryptionService).encrypt(SECRET),
      totpEnabledAt: new Date()
    });

    await expect(mfaService.beginEnrolment(stale)).rejects.toMatchObject({
      status: 409,
      response: { errorKey: ErrorKeys.AUTH.MFA_ALREADY_ENABLED }
    });
    expect((await reload(stale.id)).totpEnabledAt).not.toBeNull();
  }, 30000);

  it('refuses a disable that an administrator reset overtook', async () => {
    const stale = await createAccount('disable-stale', true);
    await mfaService.resetByAdmin(stale, { id: stale.id, email: stale.email });

    await expect(mfaService.disable(stale)).rejects.toMatchObject(notEnabled);
  }, 30000);

  it('refuses to store recovery codes on an account whose factor was turned off', async () => {
    const stale = await createAccount('regenerate-stale', true);
    await mfaService.disable(stale);

    await expect(
      mfaService.regenerateRecoveryCodes(stale)
    ).rejects.toMatchObject(notEnabled);
    expect((await reload(stale.id)).totpRecoveryCodes).toBeNull();
  }, 30000);
});
