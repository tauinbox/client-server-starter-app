import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';

// DI resolution test — does NOT require a running PostgreSQL instance.
// Catches UnknownDependenciesException, circular deps, and other wiring
// errors that unit tests cannot detect.
describe('Application bootstrap', () => {
  it('should resolve all module dependencies without errors', async () => {
    // Prevent TypeORM from opening a real DB connection during compile().
    // NestJS TypeORM accesses entityMetadatas after initialize() to set up
    // repository providers, so the mock must return a DataSource-like object.
    const initSpy = jest
      .spyOn(DataSource.prototype, 'initialize')
      .mockImplementation(function (this: DataSource) {
        return Promise.resolve(this);
      });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    const app = moduleFixture.createNestApplication();

    expect(app).toBeDefined();
    expect(initSpy).toHaveBeenCalled();

    await moduleFixture.close();
    jest.restoreAllMocks();
  });

  // Full initialization test — runs only when DB_HOST is set in process.env
  // (CI sets it explicitly; local runs without .env in process.env skip this).
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
