import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { HttpException } from '@nestjs/common';
import { FeatureFlagService } from './feature-flag.service';
import { AttributeRegistryService } from './attribute-registry.service';
import { FeatureFlag } from '../entities/feature-flag.entity';
import { FeatureFlagRule } from '../entities/feature-flag-rule.entity';

interface QueryBuilderMock {
  update: jest.Mock;
  set: jest.Mock;
  where: jest.Mock;
  execute: jest.Mock;
}

function createQueryBuilder(affected: number): QueryBuilderMock {
  const qb: QueryBuilderMock = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected })
  };
  return qb;
}

describe('FeatureFlagService', () => {
  let service: FeatureFlagService;
  let flagRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let ruleRepo: { find: jest.Mock; manager: { transaction: jest.Mock } };
  let dataSource: { transaction: jest.Mock };
  let attributeRegistry: AttributeRegistryService;

  const sampleFlag: FeatureFlag = {
    id: 'flag-1',
    key: 'new-dashboard',
    description: null,
    enabled: false,
    environments: [],
    public: false,
    version: 1,
    updatedByUserId: null,
    rules: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  beforeEach(async () => {
    flagRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      createQueryBuilder: jest.fn()
    };
    ruleRepo = {
      find: jest.fn().mockResolvedValue([]),
      manager: { transaction: jest.fn() }
    };
    dataSource = { transaction: jest.fn() };
    attributeRegistry = new AttributeRegistryService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureFlagService,
        { provide: getRepositoryToken(FeatureFlag), useValue: flagRepo },
        { provide: getRepositoryToken(FeatureFlagRule), useValue: ruleRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: AttributeRegistryService, useValue: attributeRegistry }
      ]
    }).compile();

    service = module.get(FeatureFlagService);
  });

  describe('findOne', () => {
    it('returns the flag with rules ordered by createdAt', async () => {
      flagRepo.findOne.mockResolvedValue(sampleFlag);
      const rule = { id: 'r1', flagId: 'flag-1' };
      ruleRepo.find.mockResolvedValueOnce([rule]);
      const result = await service.findOne('flag-1');
      expect(result).toBe(sampleFlag);
      expect(result.rules).toEqual([rule]);
      expect(flagRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'flag-1' }
      });
      expect(ruleRepo.find).toHaveBeenCalledWith({
        where: { flagId: 'flag-1' },
        order: { createdAt: 'ASC', id: 'ASC' }
      });
    });

    it('throws NotFound when flag is missing', async () => {
      flagRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow();
    });
  });

  describe('create', () => {
    it('rejects duplicate key with 409', async () => {
      flagRepo.findOne.mockResolvedValueOnce(sampleFlag);
      await expect(
        service.create({ key: sampleFlag.key } as { key: string }, 'actor-1')
      ).rejects.toMatchObject({ status: 409 });
    });

    it('persists with defaults and returns the saved flag', async () => {
      flagRepo.findOne
        .mockResolvedValueOnce(null) // duplicate check
        .mockResolvedValueOnce({ ...sampleFlag, id: 'new-id', rules: [] }); // findOne after save
      flagRepo.create.mockReturnValue({ ...sampleFlag, id: 'new-id' });
      flagRepo.save.mockResolvedValue({ ...sampleFlag, id: 'new-id' });
      const result = await service.create(
        { key: 'beta-export', enabled: true } as {
          key: string;
          enabled: boolean;
        },
        'actor-1'
      );
      expect(result.id).toBe('new-id');
      expect(flagRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'beta-export',
          enabled: true,
          version: 1,
          updatedByUserId: 'actor-1'
        })
      );
    });
  });

  describe('update — optimistic lock', () => {
    it('returns 409 when version does not match (affected = 0)', async () => {
      flagRepo.findOne.mockResolvedValue(sampleFlag);
      const qb = createQueryBuilder(0);
      flagRepo.createQueryBuilder.mockReturnValue(qb);
      await expect(
        service.update(
          'flag-1',
          { enabled: true },
          /* expected */ 999,
          'actor-1'
        )
      ).rejects.toMatchObject({ status: 409 });
    });

    it('updates and increments version when match (affected = 1)', async () => {
      flagRepo.findOne
        .mockResolvedValueOnce(sampleFlag) // findOne preload
        .mockResolvedValueOnce({ ...sampleFlag, enabled: true, version: 2 }); // final findOne
      const qb = createQueryBuilder(1);
      flagRepo.createQueryBuilder.mockReturnValue(qb);
      const result = await service.update(
        'flag-1',
        { enabled: true },
        1,
        'actor-1'
      );
      expect(qb.where).toHaveBeenCalledWith(
        'id = :id AND version = :expected',
        { id: 'flag-1', expected: 1 }
      );
      expect(result.version).toBe(2);
    });
  });

  describe('toggle', () => {
    it('flips enabled and bumps version', async () => {
      flagRepo.findOne
        .mockResolvedValueOnce({ ...sampleFlag, enabled: false, version: 3 })
        .mockResolvedValueOnce({ ...sampleFlag, enabled: true, version: 4 });
      flagRepo.update.mockResolvedValue({});
      const result = await service.toggle('flag-1', 'actor-1');
      expect(flagRepo.update).toHaveBeenCalledWith(
        'flag-1',
        expect.objectContaining({ enabled: true, version: 4 })
      );
      expect(result.enabled).toBe(true);
    });
  });

  describe('replaceRules', () => {
    it('validates each payload and writes in a transaction', async () => {
      flagRepo.findOne
        .mockResolvedValueOnce(sampleFlag)
        .mockResolvedValueOnce({ ...sampleFlag, rules: [] });
      interface MockEm {
        delete: jest.Mock;
        create: jest.Mock;
        save: jest.Mock;
        update: jest.Mock;
      }
      const em: MockEm = {
        delete: jest.fn().mockResolvedValue({}),
        create: jest.fn((_e: unknown, v: unknown) => v),
        save: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({})
      };
      dataSource.transaction.mockImplementation(
        (cb: (em: MockEm) => Promise<unknown>) => cb(em)
      );
      await service.replaceRules(
        'flag-1',
        [
          {
            type: 'percentage',
            effect: 'include',
            payload: { type: 'percentage', percent: 25 }
          }
        ],
        'actor-1'
      );
      expect(em.delete).toHaveBeenCalledWith(FeatureFlagRule, {
        flagId: 'flag-1'
      });
      expect(em.save).toHaveBeenCalled();
      expect(em.update).toHaveBeenCalledWith(
        FeatureFlag,
        { id: 'flag-1' },
        expect.objectContaining({ updatedByUserId: 'actor-1' })
      );
    });

    it('rejects an invalid payload before writing', async () => {
      flagRepo.findOne.mockResolvedValueOnce(sampleFlag);
      await expect(
        service.replaceRules(
          'flag-1',
          [
            {
              type: 'percentage',
              effect: 'include',
              payload: { type: 'percentage', percent: 150 }
            }
          ],
          'actor-1'
        )
      ).rejects.toBeInstanceOf(HttpException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('removes the flag', async () => {
      flagRepo.findOne.mockResolvedValueOnce(sampleFlag);
      flagRepo.remove.mockResolvedValue({});
      await service.delete('flag-1');
      expect(flagRepo.remove).toHaveBeenCalledWith(sampleFlag);
    });
  });
});
