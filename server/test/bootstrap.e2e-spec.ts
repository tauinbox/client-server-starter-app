import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { CoreModule } from '../src/modules/core/core.module';

// Requires a running PostgreSQL instance (provided by CI service or local DB).
// Catches two classes of production bugs:
//   1. DI resolution failures (UnknownDependenciesException, circular deps)
//   2. Module initialization failures (DB connectivity, misconfigured providers)
describe('Application bootstrap', () => {
  let app: INestApplication;

  afterAll(async () => {
    await app?.close();
  });

  it('should resolve all module dependencies and initialize without errors', async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    expect(app).toBeDefined();
  });
});
