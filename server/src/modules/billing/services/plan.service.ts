import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SETTINGS_DATA_SOURCE } from '../../../data-sources';
import { Plan } from '../entities/plan.entity';

@Injectable()
export class PlanService {
  constructor(
    @InjectRepository(Plan, SETTINGS_DATA_SOURCE)
    private readonly planRepo: Repository<Plan>
  ) {}

  /** Active plans for the public catalog, oldest first (seed order). */
  findActive(): Promise<Plan[]> {
    return this.planRepo.find({
      where: { active: true },
      order: { createdAt: 'ASC' }
    });
  }
}
