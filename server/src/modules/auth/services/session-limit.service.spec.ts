import { Test, TestingModule } from '@nestjs/testing';
import { MAX_CONCURRENT_SESSIONS } from '@app/shared/constants/auth.constants';
import { EntitlementService } from '../../entitlements/entitlement.service';
import { SessionLimitService } from './session-limit.service';

describe('SessionLimitService', () => {
  let service: SessionLimitService;
  let entitlements: { limitFor: jest.Mock };

  beforeEach(async () => {
    entitlements = { limitFor: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionLimitService,
        { provide: EntitlementService, useValue: entitlements }
      ]
    }).compile();

    service = module.get(SessionLimitService);
  });

  it('returns the plan allowance when the plan carries one', async () => {
    entitlements.limitFor.mockResolvedValue(25);
    await expect(service.maxSessionsFor('user-1')).resolves.toBe(25);
    expect(entitlements.limitFor).toHaveBeenCalledWith('user-1', 'sessions');
  });

  it('falls back to the constant when the plan carries no sessions limit', async () => {
    entitlements.limitFor.mockResolvedValue(null);
    await expect(service.maxSessionsFor('user-1')).resolves.toBe(
      MAX_CONCURRENT_SESSIONS
    );
  });

  it('fails open to the constant when resolution rejects', async () => {
    entitlements.limitFor.mockRejectedValue(new Error('db down'));
    await expect(service.maxSessionsFor('user-1')).resolves.toBe(
      MAX_CONCURRENT_SESSIONS
    );
  });

  it('never resolves to zero, which would evict every session on sign-in', async () => {
    entitlements.limitFor.mockRejectedValue(new Error('db down'));
    await expect(service.maxSessionsFor('user-1')).resolves.toBeGreaterThan(0);
  });
});
