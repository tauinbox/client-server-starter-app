import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FeatureFlagsController } from './feature-flags.controller';
import {
  createMockRequest,
  createMockResponse
} from '../../../common/testing/express.mock';
import {
  FeatureFlagResolverService,
  type ResolverUser
} from '../services/feature-flag-resolver.service';
import { ANON_ID_COOKIE } from '../utils/anon-id-cookie';

const HOST_ANON_ID_COOKIE = `__Host-${ANON_ID_COOKIE}`;
const VALID_ANON_ID = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';
const ISSUED_ANON_ID = '0b7e2d4c-1f3a-4c5e-8a9b-6d7e8f9a0b1c';

describe('FeatureFlagsController', () => {
  let controller: FeatureFlagsController;
  let resolver: {
    buildResolverUser: jest.Mock;
    evaluateSignedIn: jest.Mock;
    evaluateAnonymous: jest.Mock;
  };
  let environment: string;

  const resolverUser: ResolverUser = {
    userId: 'user-1',
    email: 'a@b.com',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    roles: ['admin']
  };
  const signedInResult = {
    flags: { 'beta-feature': true },
    evaluatedAt: new Date().toISOString()
  };
  const anonymousResult = {
    flags: { 'public-only': true },
    evaluatedAt: new Date().toISOString()
  };

  function newResponse() {
    return createMockResponse({ cookie: jest.fn() });
  }

  beforeEach(async () => {
    environment = 'production';
    resolver = {
      buildResolverUser: jest.fn().mockResolvedValue(resolverUser),
      evaluateSignedIn: jest
        .fn()
        .mockResolvedValue({ result: signedInResult, issuedAnonId: null }),
      evaluateAnonymous: jest
        .fn()
        .mockResolvedValue({ result: anonymousResult, issuedAnonId: null })
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeatureFlagsController],
      providers: [
        { provide: FeatureFlagResolverService, useValue: resolver },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => environment) }
        }
      ]
    }).compile();

    controller = module.get(FeatureFlagsController);
  });

  it('routes authenticated requests through buildResolverUser + evaluateSignedIn', async () => {
    const req = createMockRequest({
      user: { userId: 'user-1', email: 'a@b.com' },
      cookies: {}
    });
    const res = newResponse();

    const result = await controller.evaluate(req, res);

    expect(resolver.buildResolverUser).toHaveBeenCalledWith('user-1');
    expect(resolver.evaluateSignedIn).toHaveBeenCalledWith(
      resolverUser,
      null,
      req
    );
    expect(resolver.evaluateAnonymous).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
    expect(result).toBe(signedInResult);
  });

  // A rule bucketed by device keeps the bucket a guest had, so a signed-in
  // caller must pass the same cookie on.
  it('passes the anon-id cookie of a signed-in caller to the resolver', async () => {
    const req = createMockRequest({
      user: { userId: 'user-1', email: 'a@b.com' },
      cookies: { [HOST_ANON_ID_COOKIE]: VALID_ANON_ID }
    });

    await controller.evaluate(req, newResponse());

    expect(resolver.evaluateSignedIn).toHaveBeenCalledWith(
      resolverUser,
      VALID_ANON_ID,
      req
    );
  });

  it('persists the id the resolver issues for a signed-in caller', async () => {
    resolver.evaluateSignedIn.mockResolvedValue({
      result: signedInResult,
      issuedAnonId: ISSUED_ANON_ID
    });
    const res = newResponse();

    const result = await controller.evaluate(
      createMockRequest({
        user: { userId: 'user-1', email: 'a@b.com' },
        cookies: {}
      }),
      res
    );

    expect(result).toBe(signedInResult);
    expect(res.cookie).toHaveBeenCalledWith(
      HOST_ANON_ID_COOKIE,
      ISSUED_ANON_ID,
      expect.objectContaining({ httpOnly: true, secure: true })
    );
  });

  it('falls back to evaluateAnonymous (with anon-id cookie) when req.user is undefined', async () => {
    const req = createMockRequest({
      cookies: { [HOST_ANON_ID_COOKIE]: VALID_ANON_ID }
    });
    const res = newResponse();

    const result = await controller.evaluate(req, res);

    expect(resolver.evaluateAnonymous).toHaveBeenCalledWith(VALID_ANON_ID, req);
    expect(resolver.evaluateSignedIn).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
    expect(result).toBe(anonymousResult);
  });

  // Every id the server issues is a UUID, so any other value is caller input
  // and must not reach the bucket hash.
  it('treats a cookie that is not a UUID as absent', async () => {
    const req = createMockRequest({
      cookies: { [HOST_ANON_ID_COOKIE]: 'x'.repeat(3000) }
    });

    await controller.evaluate(req, newResponse());

    expect(resolver.evaluateAnonymous).toHaveBeenCalledWith(null, req);
  });

  // A sibling host can plant the bare name for the parent domain, and would
  // then pick the rollout bucket of the visitor.
  it('ignores the bare cookie name outside local', async () => {
    const req = createMockRequest({
      cookies: { [ANON_ID_COOKIE]: VALID_ANON_ID }
    });

    await controller.evaluate(req, newResponse());

    expect(resolver.evaluateAnonymous).toHaveBeenCalledWith(null, req);
  });

  it('reads the bare cookie name in local', async () => {
    environment = 'local';
    const req = createMockRequest({
      cookies: { [ANON_ID_COOKIE]: VALID_ANON_ID }
    });

    await controller.evaluate(req, newResponse());

    expect(resolver.evaluateAnonymous).toHaveBeenCalledWith(VALID_ANON_ID, req);
  });

  it('sets no cookie when the resolver issues no id', async () => {
    const req = createMockRequest({ cookies: {} });
    const res = newResponse();

    await controller.evaluate(req, res);

    expect(resolver.evaluateAnonymous).toHaveBeenCalledWith(null, req);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('persists the id the resolver issues as a prefixed httpOnly cookie', async () => {
    resolver.evaluateAnonymous.mockResolvedValue({
      result: anonymousResult,
      issuedAnonId: ISSUED_ANON_ID
    });
    const res = newResponse();

    const result = await controller.evaluate(
      createMockRequest({ cookies: {} }),
      res
    );

    expect(result).toBe(anonymousResult);
    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledWith(
      HOST_ANON_ID_COOKIE,
      ISSUED_ANON_ID,
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        maxAge: 365 * 24 * 60 * 60 * 1000
      })
    );
  });

  it('issues the bare name without Secure in local', async () => {
    environment = 'local';
    resolver.evaluateAnonymous.mockResolvedValue({
      result: anonymousResult,
      issuedAnonId: ISSUED_ANON_ID
    });
    const res = newResponse();

    await controller.evaluate(createMockRequest({ cookies: {} }), res);

    expect(res.cookie).toHaveBeenCalledWith(
      ANON_ID_COOKIE,
      ISSUED_ANON_ID,
      expect.objectContaining({ secure: false, path: '/' })
    );
  });
});
