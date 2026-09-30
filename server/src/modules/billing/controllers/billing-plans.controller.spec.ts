import { Test, TestingModule } from '@nestjs/testing';
import { BillingPlansController } from './billing-plans.controller';
import { PlanService } from '../services/plan.service';
import { PaddleProvider } from '../providers/paddle.provider';
import { Plan } from '../entities/plan.entity';

describe('BillingPlansController', () => {
  let controller: BillingPlansController;
  let planService: { findActive: jest.Mock };
  let paddleProvider: { clientConfig: jest.Mock };

  beforeEach(async () => {
    planService = { findActive: jest.fn() };
    paddleProvider = { clientConfig: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingPlansController],
      providers: [
        { provide: PlanService, useValue: planService },
        { provide: PaddleProvider, useValue: paddleProvider }
      ]
    }).compile();

    controller = module.get(BillingPlansController);
  });

  it('delegates to PlanService.findActive', async () => {
    const plans = [{ key: 'free' } as Plan];
    planService.findActive.mockResolvedValue(plans);

    await expect(controller.findPlans()).resolves.toBe(plans);
    expect(planService.findActive).toHaveBeenCalledTimes(1);
  });

  it('returns the Paddle.js configuration of the provider', () => {
    const config = { clientToken: 'test_abc', environment: 'sandbox' };
    paddleProvider.clientConfig.mockReturnValue(config);

    expect(controller.getPaddleConfig()).toBe(config);
  });
});
