import { HttpException, HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { CoreModule } from '../src/modules/core/core.module';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { User } from '../src/modules/users/entities/user.entity';

// The row is written fire-and-forget through a repository of its own, and the
// enum value only exists once the migration has run - neither is observable
// without a real Postgres.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Register conflict is audited (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;

  const emails: string[] = [];

  const registerDto = (email: string) => ({
    email,
    password: 'Password1',
    firstName: 'Conflict',
    lastName: 'Probe'
  });

  const takenEmail = (label: string): string => {
    const email = `register-conflict-${label}-${Date.now()}@example.com`;
    emails.push(email);
    return email;
  };

  // logFireAndForget resolves on its own microtask chain, so the row can land
  // after register() has already rejected.
  const waitForAuditRows = async (
    actorEmail: string,
    action: AuditAction
  ): Promise<AuditLog[]> => {
    const repository = dataSource.getRepository(AuditLog);
    for (let attempt = 0; attempt < 40; attempt++) {
      const rows = await repository.find({ where: { actorEmail, action } });
      if (rows.length > 0) return rows;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return [];
  };

  const statusOf = async (run: Promise<unknown>): Promise<number> => {
    try {
      await run;
      return HttpStatus.OK;
    } catch (error) {
      if (error instanceof HttpException) return error.getStatus();
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
  }, 60000);

  afterAll(async () => {
    if (emails.length) {
      const conditions = emails.map((email) => ({ email }));
      await dataSource?.getRepository(User).delete(conditions);
      await dataSource
        ?.getRepository(AuditLog)
        .delete(emails.map((email) => ({ actorEmail: email })));
    }
    await app?.close();
  });

  it('writes one USER_REGISTER_CONFLICT row and no USER_REGISTER row', async () => {
    const email = takenEmail('taken');

    await authService.register(registerDto(email));
    expect(
      await waitForAuditRows(email, AuditAction.USER_REGISTER)
    ).toHaveLength(1);

    const status = await statusOf(
      authService.register(registerDto(email), {
        ip: '203.0.113.7',
        requestId: 'e2e-register-conflict'
      })
    );
    expect(status).toBe(HttpStatus.CONFLICT);

    const conflictRows = await waitForAuditRows(
      email,
      AuditAction.USER_REGISTER_CONFLICT
    );
    expect(conflictRows).toHaveLength(1);
    expect(conflictRows[0].ipAddress).toBe('203.0.113.7');
    expect(conflictRows[0].requestId).toBe('e2e-register-conflict');

    const registerRows = await dataSource.getRepository(AuditLog).find({
      where: { actorEmail: email, action: AuditAction.USER_REGISTER }
    });
    expect(registerRows).toHaveLength(1);
  });

  it('audits a conflict against an address held as a pending email change', async () => {
    const owner = takenEmail('owner');
    const pending = takenEmail('pending');

    await authService.register(registerDto(owner));
    await dataSource
      .getRepository(User)
      .update({ email: owner }, { pendingEmail: pending });

    const status = await statusOf(authService.register(registerDto(pending)));
    expect(status).toBe(HttpStatus.CONFLICT);

    expect(
      await waitForAuditRows(pending, AuditAction.USER_REGISTER_CONFLICT)
    ).toHaveLength(1);
  });
});
