import { Test, TestingModule } from '@nestjs/testing';
import { CoreModule } from '../src/modules/core/core.module';

// Does NOT require a running PostgreSQL instance.
// Catches DI resolution failures (UnknownDependenciesException, circular deps)
// that unit tests cannot detect. DB connectivity is tested separately in CI
// against a real PostgreSQL service.
describe('Application bootstrap', () => {
  it('should resolve all module dependencies without errors', async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    const app = moduleFixture.createNestApplication();

    expect(app).toBeDefined();
  });
});
