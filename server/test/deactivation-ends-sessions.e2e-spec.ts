import { randomUUID } from 'crypto';
import { HttpException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { RefreshTokenService } from '../src/modules/auth/services/refresh-token.service';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity';
import {
  AbilityBuilder,
  createMongoAbility,
  type AppAbility
} from '../src/modules/auth/casl/app-ability';
import type { JwtAuthRequest } from '../src/modules/auth/types/auth.request';
import { UsersController } from '../src/modules/users/controllers/users.controller';
import { User } from '../src/modules/users/entities/user.entity';

// The refresh path never reads tokenRevokedAt, so only the refresh rows decide
// whether a session survives a deactivation. The controller emit, the real
// event bus, the listener and Postgres are all links of that chain.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('A deactivation ends the sessions (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let refreshTokenService: RefreshTokenService;
  let usersController: UsersController;
  const email = `deactivation-sessions-${Date.now()}@example.com`;
  let userId: string;

  const adminRequest = (): {
    user: JwtAuthRequest['user'];
    ip: string;
    headers: Record<string, string>;
  } => ({
    user: {
      userId: randomUUID(),
      email: 'admin@example.com',
      roles: [],
      sessionId: randomUUID()
    },
    ip: '127.0.0.1',
    headers: {}
  });

  const superAbility = (): AppAbility => {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
    can('manage', 'all');
    return build();
  };

  const patch = (dto: { isActive?: boolean; firstName?: string }) =>
    usersController.update(
      userId,
      dto,
      adminRequest() as JwtAuthRequest,
      superAbility()
    );

  const seedSession = async (): Promise<string> => {
    const raw = `raw-${randomUUID()}`;
    await refreshTokenService.createRefreshToken(
      userId,
      raw,
      3600,
      randomUUID(),
      null
    );
    return raw;
  };

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

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    authService = app.get(AuthService);
    refreshTokenService = app.get(RefreshTokenService);
    usersController = app.get(UsersController);

    jest.spyOn(app.get(AuditService), 'log').mockResolvedValue(undefined);
    jest
      .spyOn(app.get(AuditService), 'logFireAndForget')
      .mockImplementation(() => undefined);

    const repository = dataSource.getRepository(User);
    const user = await repository.save(
      repository.create({
        email,
        firstName: 'Deactivation',
        lastName: 'Sessions',
        isEmailVerified: true,
        password: null
      })
    );
    userId = user.id;
  }, 60000);

  beforeEach(async () => {
    await dataSource.getRepository(RefreshToken).delete({ userId });
    await dataSource.getRepository(User).update(userId, { isActive: true });
  });

  afterAll(async () => {
    await dataSource?.getRepository(User).delete({ email });
    await app?.close();
  });

  it('refuses a refresh token issued before the account was deactivated', async () => {
    const raw = await seedSession();

    await patch({ isActive: false });
    expect(
      await dataSource.getRepository(RefreshToken).count({ where: { userId } })
    ).toBe(0);

    await patch({ isActive: true });

    // Pre-fix the kept row minted a new access token here.
    expect(await errorKeyOf(authService.refreshTokens(raw))).toBe(
      ErrorKeys.AUTH.INVALID_REFRESH_TOKEN
    );
  }, 30000);

  it('keeps the session when the update does not deactivate', async () => {
    const raw = await seedSession();

    await patch({ firstName: 'Renamed' });
    await patch({ isActive: true });

    expect(await errorKeyOf(authService.refreshTokens(raw))).toBe('RESOLVED');
  }, 30000);
});
