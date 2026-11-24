import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InjectRepository } from '@nestjs/typeorm';
import { SETTINGS_DATA_SOURCE } from '../../data-sources';
import { Plan } from '../../modules/billing/entities/plan.entity';
import { User } from '../../modules/users/entities/user.entity';
import { repositoryToken } from './repository-token';

@Injectable()
class Reader {
  constructor(
    @InjectRepository(Plan, SETTINGS_DATA_SOURCE) readonly plans: unknown,
    @InjectRepository(User) readonly users: unknown
  ) {}
}

describe('repositoryToken', () => {
  it('gives the token that @InjectRepository reads on each data source', async () => {
    const plans = { name: 'plans' };
    const users = { name: 'users' };

    const moduleRef = await Test.createTestingModule({
      providers: [
        Reader,
        { provide: repositoryToken(Plan), useValue: plans },
        { provide: repositoryToken(User), useValue: users }
      ]
    }).compile();

    const reader = moduleRef.get(Reader);

    expect(reader.plans).toBe(plans);
    expect(reader.users).toBe(users);
  });
});
