import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { HttpException } from '@nestjs/common';
import { ErrorKeys } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { AuditService } from '../../audit/audit.service';
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
  let configService: { get: jest.Mock };
  let auditService: { log: jest.Mock };

  const actor = {
    actorId: 'actor-1',
    actorEmail: 'a@b.com',
    context: { ip: '127.0.0.1', requestId: 'req-1' }
  };
  const auditFields = {
    actorId: 'actor-1',
    actorEmail: 'a@b.com',
    targetType: 'FeatureFlag',
    context: { ip: '127.0.0.1', requestId: 'req-1' }
  };

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
    configService = {
      get: jest.fn((key: string) =>
        key === 'ENVIRONMENT' ? 'production' : undefined
      )
    };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureFlagService,
        { provide: getRepositoryToken(FeatureFlag), useValue: flagRepo },
        { provide: getRepositoryToken(FeatureFlagRule), useValue: ruleRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: AttributeRegistryService, useValue: attributeRegistry },
        { provide: ConfigService, useValue: configService },
        { provide: AuditService, useValue: auditService }
      ]
    }).compile();

    service = module.get(FeatureFlagService);
  });

  describe('getAttributeCustomKeys', () => {
    it('reports the registered custom keys, sorted, without the built-ins', () => {
      attributeRegistry.registerAttribute('tier', () => 'pro');
      attributeRegistry.registerAttribute('billingConfigured', () => true);

      expect(service.getAttributeCustomKeys()).toEqual({
        customKeys: ['billingConfigured', 'tier']
      });
    });

    it('reports an empty list when no module registered an attribute', () => {
      expect(service.getAttributeCustomKeys()).toEqual({ customKeys: [] });
    });
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

  interface MockEm {
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
  }

  function mockTransaction(overrides: Partial<MockEm> = {}): MockEm {
    const em: MockEm = {
      create: jest.fn((_e: unknown, v: unknown) => v),
      save: jest.fn((_e: unknown, v: unknown) => Promise.resolve(v)),
      delete: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({}),
      createQueryBuilder: jest.fn(),
      ...overrides
    };
    dataSource.transaction.mockImplementation(
      (cb: (em: MockEm) => Promise<unknown>) => cb(em)
    );
    return em;
  }

  const percentRule = (percent: number) => ({
    effect: 'include' as const,
    payload: { type: 'percentage' as const, percent }
  });

  describe('create', () => {
    it('rejects duplicate key with 409', async () => {
      flagRepo.findOne.mockResolvedValueOnce(sampleFlag);
      await expect(
        service.create({ key: sampleFlag.key }, actor)
      ).rejects.toMatchObject({ status: 409 });
    });

    it('persists with defaults and returns the saved flag', async () => {
      flagRepo.findOne
        .mockResolvedValueOnce(null) // duplicate check
        .mockResolvedValueOnce({ ...sampleFlag, id: 'new-id', rules: [] }); // findOne after save
      const em = mockTransaction({
        save: jest.fn().mockResolvedValue({ ...sampleFlag, id: 'new-id' })
      });
      const result = await service.create(
        { key: 'beta-export', enabled: true },
        actor
      );
      expect(result.id).toBe('new-id');
      expect(em.create).toHaveBeenCalledWith(
        FeatureFlag,
        expect.objectContaining({
          key: 'beta-export',
          enabled: true,
          version: 1,
          updatedByUserId: 'actor-1'
        })
      );
      expect(em.delete).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        {
          ...auditFields,
          action: AuditAction.FEATURE_FLAG_CREATE,
          targetId: 'new-id',
          details: { key: sampleFlag.key, flagId: 'new-id' }
        },
        em
      );
    });

    it('fails the create when the audit row cannot be written', async () => {
      flagRepo.findOne.mockResolvedValueOnce(null);
      mockTransaction();
      auditService.log.mockRejectedValueOnce(new Error('audit down'));

      await expect(
        service.create({ key: 'beta-export' }, actor)
      ).rejects.toThrow('audit down');
    });

    it('writes the rules in the same transaction as the flag', async () => {
      flagRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...sampleFlag, id: 'new-id' });
      const em = mockTransaction({
        save: jest
          .fn()
          .mockResolvedValueOnce({ ...sampleFlag, id: 'new-id' })
          .mockResolvedValue({})
      });
      await service.create(
        { key: 'beta-export', rules: [percentRule(25), percentRule(50)] },
        actor
      );
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: { key: sampleFlag.key, flagId: 'new-id', ruleCount: 2 }
        }),
        em
      );
      expect(em.delete).toHaveBeenCalledWith(FeatureFlagRule, {
        flagId: 'new-id'
      });
      expect(em.create).toHaveBeenCalledWith(FeatureFlagRule, {
        flagId: 'new-id',
        ...percentRule(50)
      });
      expect(em.save).toHaveBeenCalledTimes(3);
    });

    it('rejects an invalid rule payload before the transaction opens', async () => {
      flagRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.create({ key: 'beta-export', rules: [percentRule(150)] }, actor)
      ).rejects.toBeInstanceOf(HttpException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('maps a lost duplicate-key race to 409 with the flag-specific key', async () => {
      flagRepo.findOne.mockResolvedValueOnce(null); // duplicate check passes
      mockTransaction({
        save: jest.fn().mockRejectedValue({ code: '23505' })
      });

      await expect(
        service.create({ key: sampleFlag.key }, actor)
      ).rejects.toMatchObject({
        status: 409,
        response: { errorKey: ErrorKeys.FEATURE_FLAGS.KEY_EXISTS }
      });
    });

    it('reads the unique-violation code from a wrapped driver error', async () => {
      flagRepo.findOne.mockResolvedValueOnce(null);
      mockTransaction({
        save: jest.fn().mockRejectedValue({ driverError: { code: '23505' } })
      });

      await expect(
        service.create({ key: sampleFlag.key }, actor)
      ).rejects.toMatchObject({ status: 409 });
    });

    it('rethrows non-unique database errors untouched', async () => {
      flagRepo.findOne.mockResolvedValueOnce(null);
      mockTransaction({
        save: jest.fn().mockRejectedValue(new Error('connection reset'))
      });

      await expect(
        service.create({ key: sampleFlag.key }, actor)
      ).rejects.toThrow('connection reset');
    });
  });

  describe('update — optimistic lock', () => {
    it('returns 409 before the write when the given flag is not at the expected version', async () => {
      await expect(
        service.update(sampleFlag, { enabled: true }, 2, actor)
      ).rejects.toMatchObject({
        status: 409,
        response: { errorKey: ErrorKeys.FEATURE_FLAGS.VERSION_CONFLICT }
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('reports a bad rule payload before a version mismatch, as the mock does', async () => {
      await expect(
        service.update(sampleFlag, { rules: [percentRule(150)] }, 2, actor)
      ).rejects.toMatchObject({ status: 400 });
    });

    it('returns 409 when the version-checked write matches no row (affected = 0)', async () => {
      const em = mockTransaction({
        createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder(0))
      });
      await expect(
        service.update(
          sampleFlag,
          { enabled: true, rules: [percentRule(25)] },
          1,
          actor
        )
      ).rejects.toMatchObject({
        status: 409,
        response: { errorKey: ErrorKeys.FEATURE_FLAGS.VERSION_CONFLICT }
      });
      expect(flagRepo.findOne).not.toHaveBeenCalled();
      expect(em.delete).not.toHaveBeenCalled();
      expect(em.save).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('updates and increments version when match (affected = 1)', async () => {
      flagRepo.findOne.mockResolvedValueOnce({
        ...sampleFlag,
        enabled: true,
        version: 2
      });
      const qb = createQueryBuilder(1);
      const em = mockTransaction({
        createQueryBuilder: jest.fn().mockReturnValue(qb)
      });
      const result = await service.update(
        sampleFlag,
        { enabled: true },
        1,
        actor
      );
      expect(qb.where).toHaveBeenCalledWith(
        'id = :id AND version = :expected',
        { id: 'flag-1', expected: 1 }
      );
      expect(result.version).toBe(2);
      expect(flagRepo.findOne).toHaveBeenCalledTimes(1);
      expect(em.delete).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        {
          ...auditFields,
          action: AuditAction.FEATURE_FLAG_UPDATE,
          targetId: 'flag-1',
          details: { changedFields: ['enabled'] }
        },
        em
      );
    });

    it('replaces the rules after the version-checked write', async () => {
      flagRepo.findOne.mockResolvedValue(sampleFlag);
      const qb = createQueryBuilder(1);
      const em = mockTransaction({
        createQueryBuilder: jest.fn().mockReturnValue(qb)
      });
      await service.update(sampleFlag, { rules: [] }, 1, actor);
      expect(qb.execute).toHaveBeenCalledTimes(1);
      expect(em.delete).toHaveBeenCalledWith(FeatureFlagRule, {
        flagId: 'flag-1'
      });
      expect(em.save).not.toHaveBeenCalled();
    });

    it('audits a rule set as a count, not as a changed field', async () => {
      flagRepo.findOne.mockResolvedValue(sampleFlag);
      const em = mockTransaction({
        createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder(1))
      });
      await service.update(
        sampleFlag,
        { enabled: true, rules: [percentRule(25)] },
        1,
        actor
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: { changedFields: ['enabled'], ruleCount: 1 }
        }),
        em
      );
    });

    it('fails the update when the audit row cannot be written', async () => {
      flagRepo.findOne.mockResolvedValue(sampleFlag);
      mockTransaction({
        createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder(1))
      });
      auditService.log.mockRejectedValueOnce(new Error('audit down'));

      await expect(
        service.update(sampleFlag, { enabled: true }, 1, actor)
      ).rejects.toThrow('audit down');
    });

    it('rejects an invalid rule payload before the transaction opens', async () => {
      await expect(
        service.update(sampleFlag, { rules: [percentRule(150)] }, 1, actor)
      ).rejects.toBeInstanceOf(HttpException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('preview', () => {
    const previewRule: FeatureFlagRule = {
      id: 'r1',
      flagId: 'flag-1',
      flag: sampleFlag,
      effect: 'include',
      payload: { type: 'role', roleNames: ['beta'] },
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const previewFlag: FeatureFlag = {
      ...sampleFlag,
      enabled: true,
      environments: ['production'],
      rules: [previewRule]
    };

    it('evaluates against synthetic role context and returns included-by-rule', () => {
      const result = service.preview(previewFlag, { roles: ['beta'] });
      expect(result.result).toBe(true);
      expect(result.reason).toBe('included-by-rule');
      expect(result.matchedRule).toEqual({
        index: 0,
        type: 'role',
        effect: 'include'
      });
    });

    it('returns env-mismatch when synthetic env does not match the flag', () => {
      const result = service.preview(previewFlag, {
        roles: ['beta'],
        env: 'staging'
      });
      expect(result).toEqual({
        result: false,
        reason: 'env-mismatch',
        matchedRule: null
      });
    });

    it('falls back to ConfigService ENVIRONMENT when ctx.env is omitted', () => {
      service.preview(previewFlag, { roles: ['beta'] });
      expect(configService.get).toHaveBeenCalledWith('ENVIRONMENT');
    });

    it('reads nothing and writes nothing', () => {
      service.preview(previewFlag, { roles: ['beta'] });
      expect(flagRepo.findOne).not.toHaveBeenCalled();
      expect(ruleRepo.find).not.toHaveBeenCalled();
      expect(flagRepo.save).not.toHaveBeenCalled();
      expect(flagRepo.update).not.toHaveBeenCalled();
      expect(flagRepo.remove).not.toHaveBeenCalled();
      expect(flagRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('evaluates a supplied rule set instead of the persisted one', () => {
      const result = service.preview(previewFlag, {
        roles: ['beta'],
        rules: [
          {
            effect: 'include',
            payload: { type: 'role', roleNames: ['gamma'] }
          }
        ]
      });
      expect(result.result).toBe(false);
      expect(result.matchedRule).toBeNull();
    });

    it('matches a supplied rule the persisted set does not contain', () => {
      const result = service.preview(
        { ...previewFlag, rules: [] },
        {
          roles: ['gamma'],
          rules: [
            {
              effect: 'include',
              payload: { type: 'role', roleNames: ['gamma'] }
            }
          ]
        }
      );
      expect(result.result).toBe(true);
      expect(result.reason).toBe('included-by-rule');
      expect(result.matchedRule).toEqual({
        index: 0,
        type: 'role',
        effect: 'include'
      });
    });

    it('rejects a supplied rule payload the save path also rejects', () => {
      let error: unknown;
      try {
        service.preview(previewFlag, {
          rules: [
            {
              effect: 'include',
              // @ts-expect-error probing the runtime validator with a bad payload
              payload: { type: 'user', userIds: 'not-an-array' }
            }
          ]
        });
      } catch (e: unknown) {
        error = e;
      }
      expect(error).toMatchObject({
        status: 400,
        response: {
          message: 'user rule requires userIds: an array of up to 100 UUIDs'
        }
      });
    });

    it('evaluates a supplied enabled flag state instead of the stored one', () => {
      const result = service.preview(previewFlag, {
        roles: ['beta'],
        enabled: false
      });
      expect(result).toEqual({
        result: false,
        reason: 'disabled',
        matchedRule: null
      });
    });

    it('evaluates a supplied environment list instead of the stored one', () => {
      const result = service.preview(previewFlag, {
        roles: ['beta'],
        environments: ['staging']
      });
      expect(result).toEqual({
        result: false,
        reason: 'env-mismatch',
        matchedRule: null
      });
    });
  });

  describe('delete', () => {
    it('removes the given flag and audits its key in one transaction', async () => {
      const em = mockTransaction();
      await service.delete(sampleFlag, actor);
      expect(flagRepo.findOne).not.toHaveBeenCalled();
      expect(em.remove).toHaveBeenCalledWith(FeatureFlag, sampleFlag);
      expect(auditService.log).toHaveBeenCalledWith(
        {
          ...auditFields,
          action: AuditAction.FEATURE_FLAG_DELETE,
          targetId: 'flag-1',
          details: { key: sampleFlag.key }
        },
        em
      );
    });

    it('fails the delete when the audit row cannot be written', async () => {
      mockTransaction();
      auditService.log.mockRejectedValueOnce(new Error('audit down'));

      await expect(service.delete(sampleFlag, actor)).rejects.toThrow(
        'audit down'
      );
    });
  });
});
