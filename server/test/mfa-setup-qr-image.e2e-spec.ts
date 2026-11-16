import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { MfaService } from '../src/modules/auth/services/mfa.service';
import { User } from '../src/modules/users/entities/user.entity';

// The unit spec stubs the encoder, because one image costs about half a second
// of CPU under Jest. This suite encodes a real image in the assembled app.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);
// A version 1 QR symbol is 21 modules wide, so no real code is narrower.
const MIN_QR_WIDTH = 21;

runWithInfra('MFA setup QR image (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const previousKey = process.env['MFA_ENCRYPTION_KEY'];
  const email = `mfa-setup-qr-${Date.now()}@example.com`;

  beforeAll(async () => {
    process.env['MFA_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
  }, 60000);

  afterAll(async () => {
    if (previousKey === undefined) delete process.env['MFA_ENCRYPTION_KEY'];
    else process.env['MFA_ENCRYPTION_KEY'] = previousKey;

    await dataSource?.getRepository(User).delete({ email });
    await app?.close();
  });

  it('returns a PNG QR image of the setup URI', async () => {
    const repository = dataSource.getRepository(User);
    const user = await repository.save(
      repository.create({
        email,
        name: 'Mfa Setup Qr',
        password: null,
        isEmailVerified: true
      })
    );

    const { otpauthUri, qrDataUrl } = await app
      .get(MfaService)
      .beginEnrolment(user);

    expect(otpauthUri).toContain('otpauth://totp/');
    const [prefix, payload] = qrDataUrl.split(',');

    expect(prefix).toBe('data:image/png;base64');
    const png = Buffer.from(payload, 'base64');

    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(png.toString('ascii', 12, 16)).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(MIN_QR_WIDTH);
  }, 30000);
});
