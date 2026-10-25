import { Controller, INestApplication } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { RegisterResource } from '../src/modules/auth/decorators/register-resource.decorator';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { Resource } from '../src/modules/auth/entities/resource.entity';
import { ResourceSyncService } from '../src/modules/auth/services/resource-sync.service';

// The startup sync owns the action lists of a resource; the display name is
// an admin field and survives a restart.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Startup sync of an edited resource (e2e)', () => {
  const stamp = Date.now();
  const name = `sync-display-name-${stamp}`;

  @RegisterResource({
    name,
    subject: `SyncDisplayName${stamp}`,
    displayName: 'Declared name',
    description: 'Declared description',
    actions: ['read'],
    conditionalActions: []
  })
  @Controller()
  class SyncProbeController {}

  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);

    // The real controllers stay in the list, so the sync orphans none of them.
    const discovery = app.get(DiscoveryService);
    const controllers = discovery.getControllers();
    jest
      .spyOn(discovery, 'getControllers')
      .mockReturnValue([
        ...controllers,
        new InstanceWrapper({ metatype: SyncProbeController })
      ]);
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      const resource = await dataSource
        .getRepository(Resource)
        .findOneBy({ name });
      if (resource) {
        await dataSource
          .getRepository(Permission)
          .delete({ resourceId: resource.id });
        await dataSource.getRepository(Resource).delete({ id: resource.id });
      }
    }
    await app?.close();
  });

  it('keeps the display name and the description that an admin edited', async () => {
    const sync = app.get(ResourceSyncService);
    const resources = dataSource.getRepository(Resource);

    await sync.onApplicationBootstrap();
    const created = await resources.findOneByOrFail({ name });
    expect(created.displayName).toBe('Declared name');

    await resources.update(
      { id: created.id },
      { displayName: 'Edited name', description: 'Edited description' }
    );
    await sync.onApplicationBootstrap();

    // No isOrphaned check: the app of a parallel suite syncs the same database
    // without this controller, and a sync never clears the flag.
    const synced = await resources.findOneByOrFail({ name });
    expect(synced).toEqual(
      expect.objectContaining({
        displayName: 'Edited name',
        description: 'Edited description',
        actionNames: ['read']
      })
    );
  });
});
