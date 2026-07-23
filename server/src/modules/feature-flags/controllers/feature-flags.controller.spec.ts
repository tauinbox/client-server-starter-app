import { Test, TestingModule } from '@nestjs/testing';
import { FeatureFlagsController } from './feature-flags.controller';
import { createMockRequest } from '../../../common/testing/express.mock';
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
    const req = createMockRequest({
      user: { userId: 'user-1', email: 'a@b.com' },
      cookies: {}
    });

    const result = await controller.evaluate(req);

    expect(resolver.buildResolverUser).toHaveBeenCalledWith('user-1');
    expect(resolver.evaluateForUser).toHaveBeenCalledWith(resolverUser, req);
    expect(resolver.evaluateAnonymous).not.toHaveBeenCalled();
    expect(result.flags['beta-feature']).toBe(true);
  });

  it('falls back to evaluateAnonymous (with anon-id cookie) when req.user is undefined', async () => {
    const req = createMockRequest({
      cookies: { [ANON_ID_COOKIE]: 'anon-xyz' }
    });

    await controller.evaluate(req);

    expect(resolver.evaluateAnonymous).toHaveBeenCalledWith('anon-xyz', req);
    expect(resolver.evaluateForUser).not.toHaveBeenCalled();
  });

  it('passes null anonId when the cookie is absent', async () => {
    const req = createMockRequest({ cookies: {} });

    await controller.evaluate(req);

    expect(resolver.evaluateAnonymous).toHaveBeenCalledWith(null, req);
  });
});
