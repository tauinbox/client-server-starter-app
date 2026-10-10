import {
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'http';
import { DataSource, Like } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { User } from '../src/modules/users/entities/user.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { Resource } from '../src/modules/auth/entities/resource.entity';
import { FeatureFlag } from '../src/modules/feature-flags/entities/feature-flag.entity';
import { withPrivateThrottlerStorage } from './private-throttler';

// Search and filters of the four admin lists against real Postgres: every
// case walks the keyset pages with limit=1, so it also proves that the
// filtered pages stay complete. CI runs the migrations and not the seeders;
// the super role comes from them.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('List search and filters (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  const stamp = `lq${Date.now()}`;
  const password = 'Lantern-Orchard-47';
  // No dash after the stamp: the user searches below match `${stamp}-` only.
  const adminEmail = `${stamp}admin@example.com`;

  beforeAll(async () => {
    const moduleRef: TestingModule = await withPrivateThrottlerStorage(
      Test.createTestingModule({ imports: [CoreModule.forRoot()] })
    ).compile();

    const expressApp = moduleRef.createNestApplication<NestExpressApplication>(
      HTTP_BODY_APP_OPTIONS
    );
    applyBodyParsers(expressApp);
    app = expressApp;
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true
      })
    );
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();

    dataSource = app.get(DataSource);

    await register(adminEmail);
    const superRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ isSuper: true });
    const usersService = app.get(UsersService);
    const adminId = await userId(adminEmail);
    await app.get(RoleService).assignRoleToUser(adminId, superRole.id);
    const { tokens } = await app
      .get(AuthService)
      .login(await usersService.findOne(adminId), {
        userAgent: 'list-query-e2e',
        ipAddress: null
      });
    token = tokens.access_token;
  }, 60000);

  afterAll(async () => {
    await dataSource
      ?.getRepository(FeatureFlag)
      .delete({ key: Like(`${stamp}%`) });
    await dataSource?.getRepository(Role).delete({ name: Like(`${stamp}%`) });
    await dataSource
      ?.getRepository(Resource)
      .delete({ name: Like(`${stamp}%`) });
    await dataSource?.getRepository(User).delete({ email: Like(`${stamp}%`) });
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  async function register(email: string): Promise<void> {
    await request(http())
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'List', lastName: 'Query' })
      .expect(201);
  }

  async function userId(email: string): Promise<string> {
    const found = await dataSource
      .getRepository(User)
      .findOneOrFail({ where: { email } });
    return found.id;
  }

  /** Every row of a filtered list, one keyset page at a time. */
  async function pages<T>(path: string, query: string): Promise<T[]> {
    const rows: T[] = [];
    let cursor: string | null = null;
    let guard = 0;
    do {
      const res = await request(http())
        .get(`/api/v1/${path}`)
        .query(
          `${query}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
        )
        .auth(token, { type: 'bearer' })
        .expect(200);
      const body = res.body as {
        data: T[];
        meta: { nextCursor: string | null };
      };
      rows.push(...body.data);
      cursor = body.meta.nextCursor;
      guard += 1;
    } while (cursor && guard < 50);
    return rows;
  }

  function sorted(values: string[]): string[] {
    return [...values].sort();
  }

  describe('feature flags', () => {
    const keys = {
      everywhere: `${stamp}-everywhere`,
      production: `${stamp}-production`,
      staging: `${stamp}-staging`
    };

    beforeAll(async () => {
      const bodies = [
        {
          key: keys.everywhere,
          enabled: true,
          public: true,
          environments: []
        },
        {
          key: keys.production,
          enabled: false,
          environments: ['production'],
          description: `Rollout NOTE-${stamp}`
        },
        { key: keys.staging, enabled: false, environments: ['staging'] }
      ];
      for (const body of bodies) {
        await request(http())
          .post('/api/v1/admin/feature-flags')
          .auth(token, { type: 'bearer' })
          .send(body)
          .expect(201);
      }
    });

    async function flagKeys(query: string): Promise<string[]> {
      const rows = await pages<{ key: string }>(
        'admin/feature-flags/cursor',
        query
      );
      return sorted(rows.map((row) => row.key));
    }

    it('searches the key, case-insensitive', async () => {
      await expect(flagKeys(`q=${stamp.toUpperCase()}`)).resolves.toEqual(
        sorted(Object.values(keys))
      );
    });

    it('searches the description', async () => {
      await expect(flagKeys(`q=note-${stamp}`)).resolves.toEqual([
        keys.production
      ]);
    });

    it('ANDs the search with enabled and public', async () => {
      await expect(flagKeys(`q=${stamp}&enabled=false`)).resolves.toEqual(
        sorted([keys.production, keys.staging])
      );
      await expect(flagKeys(`q=${stamp}&public=true`)).resolves.toEqual([
        keys.everywhere
      ]);
    });

    it('matches an environment listed on the flag or a flag for every environment', async () => {
      await expect(
        flagKeys(`q=${stamp}&environment=production`)
      ).resolves.toEqual(sorted([keys.everywhere, keys.production]));
      await expect(flagKeys(`q=${stamp}&environment=local`)).resolves.toEqual([
        keys.everywhere
      ]);
    });

    it('treats a LIKE wildcard in q as a literal', async () => {
      await expect(flagKeys(`q=${stamp}%25`)).resolves.toEqual([]);
    });
  });

  describe('roles', () => {
    const names = { plain: `${stamp}-plain`, described: `${stamp}-described` };

    beforeAll(async () => {
      await dataSource.getRepository(Role).save([
        { name: names.plain, description: null },
        { name: names.described, description: `Auditors ${stamp}` }
      ]);
    });

    it('searches name and description and filters on isSystem', async () => {
      const custom = await pages<{ name: string }>(
        'roles/cursor',
        `q=${stamp}&isSystem=false`
      );
      const system = await pages<{ name: string }>(
        'roles/cursor',
        `q=${stamp}&isSystem=true`
      );
      const byDescription = await pages<{ name: string }>(
        'roles/cursor',
        'q=auditors'
      );

      expect(sorted(custom.map((r) => r.name))).toEqual(
        sorted(Object.values(names))
      );
      expect(system).toEqual([]);
      expect(byDescription.map((r) => r.name)).toContain(names.described);
    });
  });

  describe('resources', () => {
    const orphaned = `${stamp}-orphaned`;

    // The resource sync of any app that boots in a parallel spec marks every
    // resource that no controller registers as orphaned, so a row inserted
    // here as not orphaned does not stay so. `roles` (RolesController) is
    // registered by every app that runs the sync, so it is never orphaned.
    beforeAll(async () => {
      await dataSource.getRepository(Resource).save({
        name: orphaned,
        subject: `Lq${stamp}Orphaned`,
        displayName: 'List query orphaned',
        isOrphaned: true
      });
    });

    async function resourceNames(query: string): Promise<string[]> {
      const rows = await pages<{ name: string }>(
        'rbac/resources/cursor',
        query
      );
      return sorted(rows.map((row) => row.name));
    }

    it('searches the subject and filters on isOrphaned and isSystem', async () => {
      await expect(
        resourceNames(`q=lq${stamp}orphaned&isOrphaned=true&isSystem=false`)
      ).resolves.toEqual([orphaned]);
      await expect(
        resourceNames(`q=${stamp}&isOrphaned=false`)
      ).resolves.toEqual([]);
      await expect(
        resourceNames('q=roles&isOrphaned=false')
      ).resolves.toContain('roles');
      await expect(resourceNames(`q=${stamp}&isSystem=true`)).resolves.toEqual(
        []
      );
    });
  });

  describe('users', () => {
    const emails = {
      mfa: `${stamp}-mfa@example.com`,
      locked: `${stamp}-locked@example.com`,
      expired: `${stamp}-expired@example.com`
    };

    beforeAll(async () => {
      for (const email of Object.values(emails)) await register(email);
      const users = dataSource.getRepository(User);
      await users.update(
        { email: emails.mfa },
        { totpEnabledAt: new Date(), isEmailVerified: true }
      );
      await users.update(
        { email: emails.locked },
        { password: null, lockedUntil: new Date(Date.now() + 3_600_000) }
      );
      await users.update(
        { email: emails.expired },
        { lockedUntil: new Date(Date.now() - 3_600_000) }
      );
    });

    async function userEmails(query: string): Promise<string[]> {
      const rows = await pages<{ email: string }>(
        'users/search/cursor',
        `q=${stamp}-&${query}`
      );
      return sorted(rows.map((row) => row.email));
    }

    it.each([
      ['mfaEnabled=true', ['mfa']],
      ['mfaEnabled=false', ['locked', 'expired']],
      ['hasPassword=false', ['locked']],
      ['isLocked=true', ['locked']],
      ['isLocked=false', ['mfa', 'expired']],
      ['isEmailVerified=true', ['mfa']],
      ['isLocked=false&mfaEnabled=false', ['expired']]
    ] as const)('%s', async (query, expected) => {
      await expect(userEmails(query)).resolves.toEqual(
        sorted(expected.map((name) => emails[name]))
      );
    });
  });
});
