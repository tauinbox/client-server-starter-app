import { Test, TestingModule } from '@nestjs/testing';
import { BillingPlansController } from './billing-plans.controller';
import { PlanService } from '../services/plan.service';
import { Plan } from '../entities/plan.entity';

describe('BillingPlansController', () => {
  let controller: BillingPlansController;
  let planService: { findActive: jest.Mock };

  beforeEach(async () => {
    planService = { findActive: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingPlansController],
      providers: [{ provide: PlanService, useValue: planService }]
    }).compile();

    controller = module.get(BillingPlansController);
  });

  it('delegates to PlanService.findActive', async () => {
    const plans = [{ key: 'free' } as Plan];
    planService.findActive.mockResolvedValue(plans);

    await expect(controller.findPlans()).resolves.toBe(plans);
    expect(planService.findActive).toHaveBeenCalledTimes(1);
  });
});
