import { Test, TestingModule } from '@nestjs/testing';
import { repositoryToken } from '../../../common/testing/repository-token';
import { PlanService } from './plan.service';
import { Plan } from '../entities/plan.entity';

describe('PlanService', () => {
  let service: PlanService;
  let repo: { find: jest.Mock };

  beforeEach(async () => {
    repo = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanService,
        {
          provide: repositoryToken(Plan),
          useValue: repo
        }
      ]
    }).compile();

    service = module.get(PlanService);
  });

  it('returns only active plans, ordered oldest first', async () => {
    const plans = [{ key: 'free' } as Plan, { key: 'pro' } as Plan];

    repo.find.mockResolvedValue(plans);

    const result = await service.findActive();

    expect(repo.find).toHaveBeenCalledWith({
      where: { active: true },
      order: { createdAt: 'ASC' }
    });
    expect(result).toBe(plans);
  });
});
