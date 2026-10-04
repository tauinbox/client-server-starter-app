import { INestApplication, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { subject } from '@casl/ability';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import {
  AbilityBuilder,
  createMongoAbility
} from '../src/modules/auth/casl/app-ability';
import type { AppAbility } from '../src/modules/auth/casl/app-ability';
import { FeatureFlag } from '../src/modules/feature-flags/entities/feature-flag.entity';
import { FeatureFlagService } from '../src/modules/feature-flags/services/feature-flag.service';

// A conditional search:FeatureFlag narrows the flag list in SQL, to exactly the
// flags that the in-memory check allows.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Feature flag list filtered by the ability (e2e)', () => {
  const tag = `ff-ability-${Date.now()}`;
  const keys = {
    on: `${tag}-on`,
    off: `${tag}-off`,
    publicOff: `${tag}-public-off`
  };

  let app: INestApplication;
  let dataSource: DataSource;
  let flagService: FeatureFlagService;
  let flags: FeatureFlag[];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    flagService = app.get(FeatureFlagService);
    const repo = dataSource.getRepository(FeatureFlag);
    flags = await repo.save([
      repo.create({ key: keys.on, enabled: true, public: false }),
      repo.create({ key: keys.off, enabled: false, public: false }),
      repo.create({ key: keys.publicOff, enabled: false, public: true })
    ]);
  }, 60000);

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (dataSource) {
      await dataSource
        .getRepository(FeatureFlag)
        .createQueryBuilder()
        .delete()
        .where('key LIKE :prefix', { prefix: `${tag}%` })
        .execute();
    }
    await app?.close();
  });

  function abilityOf(
    define: (b: AbilityBuilder<AppAbility>) => void
  ): AppAbility {
    const builder = new AbilityBuilder<AppAbility>(createMongoAbility);
    define(builder);
    return builder.build();
  }

  async function listedKeys(ability: AppAbility): Promise<string[]> {
    const page = await flagService.findCursorPaginated(
      { limit: 100, sortBy: 'key', sortOrder: 'asc' },
      ability
    );
    return page.data.map((f) => f.key).filter((k) => k.startsWith(tag));
  }

  function allowedKeys(ability: AppAbility): string[] {
    return flags
      .filter((f) => ability.can('search', subject('FeatureFlag', { ...f })))
      .map((f) => f.key)
      .sort();
  }

  it('lists every flag for an unconditional grant', async () => {
    const ability = abilityOf((b) => b.can('search', 'FeatureFlag'));
    expect(await listedKeys(ability)).toEqual(
      [keys.off, keys.on, keys.publicOff].sort()
    );
  });

  it('lists only the flags that match an allow condition', async () => {
    const ability = abilityOf((b) =>
      b.can('search', 'FeatureFlag', { key: { $in: [keys.on, keys.off] } })
    );
    const listed = await listedKeys(ability);
    expect(listed).toEqual([keys.off, keys.on].sort());
    expect(listed).toEqual(allowedKeys(ability));
  });

  it('subtracts the flags that match a deny condition', async () => {
    const ability = abilityOf((b) => {
      b.can('search', 'FeatureFlag', { enabled: false });
      b.cannot('search', 'FeatureFlag', { public: true });
    });
    const listed = await listedKeys(ability);
    expect(listed).toEqual([keys.off]);
    expect(listed).toEqual(allowedKeys(ability));
  });

  it('lists no flag for an allow on a field the filter cannot translate', async () => {
    const ability = abilityOf((b) =>
      b.can('search', 'FeatureFlag', { description: null })
    );
    expect(await listedKeys(ability)).toEqual([]);
  });

  it('lists no flag for a deny on a field the filter cannot translate', async () => {
    const ability = abilityOf((b) => {
      b.can('search', 'FeatureFlag');
      b.cannot('search', 'FeatureFlag', { description: null });
    });
    expect(await listedKeys(ability)).toEqual([]);
  });

  it('pages through the filtered set only', async () => {
    const ability = abilityOf((b) =>
      b.can('search', 'FeatureFlag', { key: { $in: [keys.on, keys.off] } })
    );
    const first = await flagService.findCursorPaginated(
      { limit: 1, sortBy: 'key', sortOrder: 'asc' },
      ability
    );
    expect(first.data.map((f) => f.key)).toEqual([keys.off]);
    const second = await flagService.findCursorPaginated(
      {
        limit: 1,
        sortBy: 'key',
        sortOrder: 'asc',
        cursor: first.meta.nextCursor ?? undefined
      },
      ability
    );
    expect(second.data.map((f) => f.key)).toEqual([keys.on]);
    expect(second.meta.nextCursor).toBeNull();
  });
});
