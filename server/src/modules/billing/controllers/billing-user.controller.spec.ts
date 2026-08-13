import { Test, TestingModule } from '@nestjs/testing';
import type { EntitlementsResponse } from '@app/shared/types';
import type { JwtAuthRequest } from '../../auth/types/auth.request';
import { BillingUserController } from './billing-user.controller';
import { BillingUserService } from '../services/billing-user.service';
import { EntitlementService } from '../../entitlements/entitlement.service';

function mockJwtRequest(userId = 'user-1'): { user: JwtAuthRequest['user'] } {
  return { user: { userId, email: 'user@example.com', roles: [] } };
}

describe('BillingUserController', () => {
  let controller: BillingUserController;
  let capabilitiesFor: jest.Mock;

  beforeEach(async () => {
    capabilitiesFor = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingUserController],
      providers: [
        { provide: BillingUserService, useValue: {} },
        { provide: EntitlementService, useValue: { capabilitiesFor } }
      ]
    }).compile();

    controller = module.get(BillingUserController);
  });

  describe('getEntitlements', () => {
    it('returns the resolved set whole - planKey, capabilities and limits', async () => {
      const resolved: EntitlementsResponse = {
        planKey: 'pro',
        capabilities: ['reports', 'data-export'],
        limits: { sessions: 10 }
      };
      capabilitiesFor.mockResolvedValue(resolved);

      const req = mockJwtRequest() as JwtAuthRequest;
      await expect(controller.getEntitlements(req)).resolves.toEqual(resolved);
    });

    it('scopes the read to the caller from the JWT, never a client-supplied id', async () => {
      capabilitiesFor.mockResolvedValue({
        planKey: 'free',
        capabilities: [],
        limits: {}
      });

      const req = mockJwtRequest('caller-9') as JwtAuthRequest;
      // A body/query id must have no way in: the route takes none.
      req.body = { userId: 'victim-1' };
      req.query = { userId: 'victim-2' };

      await controller.getEntitlements(req);

      expect(capabilitiesFor).toHaveBeenCalledTimes(1);
      expect(capabilitiesFor).toHaveBeenCalledWith('caller-9');
    });

    it('reports the Free fallback rather than an empty body when nothing is subscribed', async () => {
      capabilitiesFor.mockResolvedValue({
        planKey: 'free',
        capabilities: [],
        limits: {}
      });

      const req = mockJwtRequest() as JwtAuthRequest;
      await expect(controller.getEntitlements(req)).resolves.toEqual({
        planKey: 'free',
        capabilities: [],
        limits: {}
      });
    });
  });
});
