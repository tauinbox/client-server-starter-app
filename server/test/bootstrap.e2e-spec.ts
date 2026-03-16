import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { CoreModule } from '../src/modules/core/core.module';

// DI resolution test — does NOT require a running PostgreSQL instance.
// Catches UnknownDependenciesException, circular deps, and other wiring
// errors that unit tests cannot detect.
describe('Application bootstrap', () => {
  it('should resolve all module dependencies without errors', async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    const app = moduleFixture.createNestApplication();

    expect(app).toBeDefined();

    await moduleFixture.close();
  });

  // Full initialization test — runs only when DB_HOST is set (i.e. in CI or
  // local dev with a running PostgreSQL instance).
  const runWithDb = process.env['DB_HOST'] ? it : it.skip;

  runWithDb(
    'should fully initialize including database connectivity',
    async () => {
      let app: INestApplication | undefined;
      try {
        const moduleFixture: TestingModule = await Test.createTestingModule({
          imports: [CoreModule.forRoot()]
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        expect(app).toBeDefined();
      } finally {
        await app?.close();
      }
    }
  );
});
