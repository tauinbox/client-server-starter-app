import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagResolverService } from '../services/feature-flag-resolver.service';
import { PermissionService } from '../../auth/services/permission.service';
import { UsersService } from '../../users/services/users.service';
import { ANON_ID_COOKIE } from '../middleware/anon-id.middleware';

describe('FeatureFlagsController', () => {
  let controller: FeatureFlagsController;
  let resolver: { evaluateForUser: jest.Mock; evaluateAnonymous: jest.Mock };
  let permissionService: { getRoleNamesForUser: jest.Mock };
  let usersService: { findOne: jest.Mock };

  const userRecord = {
    id: 'user-1',
    email: 'a@b.com',
    createdAt: new Date('2026-01-01T00:00:00Z')
  };

  beforeEach(async () => {
    resolver = {
      evaluateForUser: jest.fn().mockResolvedValue({
        flags: { 'beta-feature': true },
        evaluatedAt: new Date().toISOString()
      }),
      evaluateAnonymous: jest.fn().mockResolvedValue({
        flags: { 'public-only': true },
        evaluatedAt: new Date().toISOString()
      })
    };
    permissionService = {
      getRoleNamesForUser: jest.fn().mockResolvedValue(['admin'])
    };
    usersService = {
      findOne: jest.fn().mockResolvedValue(userRecord)
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeatureFlagsController],
      providers: [
        { provide: FeatureFlagResolverService, useValue: resolver },
        { provide: PermissionService, useValue: permissionService },
        { provide: UsersService, useValue: usersService }
      ]
    }).compile();

    controller = module.get(FeatureFlagsController);
  });

  it('routes authenticated requests through evaluateForUser with role + email + createdAt context', async () => {
    const req = {
      user: { userId: 'user-1', email: 'a@b.com' },
      cookies: {}
    } as unknown as Request & {
      user?: { userId?: string; email?: string };
    };

    const result = await controller.evaluate(req);

    expect(resolver.evaluateForUser).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        email: 'a@b.com',
        createdAt: userRecord.createdAt,
        roles: ['admin']
      },
      req
    );
    expect(resolver.evaluateAnonymous).not.toHaveBeenCalled();
    expect(result.flags['beta-feature']).toBe(true);
  });

  it('falls back to evaluateAnonymous (with anon-id cookie) when req.user is undefined', async () => {
    const req = {
      cookies: { [ANON_ID_COOKIE]: 'anon-xyz' }
    } as unknown as Request & {
      user?: { userId?: string; email?: string };
    };

    await controller.evaluate(req);

    expect(resolver.evaluateAnonymous).toHaveBeenCalledWith('anon-xyz', req);
    expect(resolver.evaluateForUser).not.toHaveBeenCalled();
  });

  it('passes null anonId when the cookie is absent', async () => {
    const req = { cookies: {} } as unknown as Request & {
      user?: { userId?: string; email?: string };
    };

    await controller.evaluate(req);

    expect(resolver.evaluateAnonymous).toHaveBeenCalledWith(null, req);
  });

  it('uses null email/createdAt when usersService rejects (orphaned token)', async () => {
    usersService.findOne.mockRejectedValueOnce(new Error('user gone'));
    const req = {
      user: { userId: 'user-1', email: 'a@b.com' },
      cookies: {}
    } as unknown as Request & {
      user?: { userId?: string; email?: string };
    };

    await controller.evaluate(req);

    expect(resolver.evaluateForUser).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        email: null,
        createdAt: null,
        roles: ['admin']
      },
      req
    );
  });
});
