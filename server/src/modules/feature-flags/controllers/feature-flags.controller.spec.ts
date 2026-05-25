import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { FeatureFlagsController } from './feature-flags.controller';
import {
  FeatureFlagResolverService,
  type ResolverUser
} from '../services/feature-flag-resolver.service';
import { ANON_ID_COOKIE } from '../middleware/anon-id.middleware';

describe('FeatureFlagsController', () => {
  let controller: FeatureFlagsController;
  let resolver: {
    buildResolverUser: jest.Mock;
    evaluateForUser: jest.Mock;
    evaluateAnonymous: jest.Mock;
  };

  const resolverUser: ResolverUser = {
    userId: 'user-1',
    email: 'a@b.com',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    roles: ['admin']
  };

  beforeEach(async () => {
    resolver = {
      buildResolverUser: jest.fn().mockResolvedValue(resolverUser),
      evaluateForUser: jest.fn().mockResolvedValue({
        flags: { 'beta-feature': true },
        evaluatedAt: new Date().toISOString()
      }),
      evaluateAnonymous: jest.fn().mockResolvedValue({
        flags: { 'public-only': true },
        evaluatedAt: new Date().toISOString()
      })
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeatureFlagsController],
      providers: [{ provide: FeatureFlagResolverService, useValue: resolver }]
    }).compile();

    controller = module.get(FeatureFlagsController);
  });

  it('routes authenticated requests through buildResolverUser + evaluateForUser', async () => {
    const req = {
      user: { userId: 'user-1', email: 'a@b.com' },
      cookies: {}
    } as unknown as Request & {
      user?: { userId?: string; email?: string };
    };

    const result = await controller.evaluate(req);

    expect(resolver.buildResolverUser).toHaveBeenCalledWith('user-1');
    expect(resolver.evaluateForUser).toHaveBeenCalledWith(resolverUser, req);
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
});
