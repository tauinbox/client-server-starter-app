import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from '../entities/plan.entity';

@Injectable()
export class PlanService {
  constructor(
    @InjectRepository(Plan)
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
