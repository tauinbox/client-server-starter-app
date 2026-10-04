import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { HttpException } from '@nestjs/common';
import { ErrorKeys } from '@app/shared/constants';
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureFlagService,
        { provide: getRepositoryToken(FeatureFlag), useValue: flagRepo },
        { provide: getRepositoryToken(FeatureFlagRule), useValue: ruleRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: AttributeRegistryService, useValue: attributeRegistry },
        { provide: ConfigService, useValue: configService }
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
    createQueryBuilder: jest.Mock;
  }

  function mockTransaction(overrides: Partial<MockEm> = {}): MockEm {
    const em: MockEm = {
      create: jest.fn((_e: unknown, v: unknown) => v),
      save: jest.fn((_e: unknown, v: unknown) => Promise.resolve(v)),
      delete: jest.fn().mockResolvedValue({}),
      createQueryBuilder: jest.fn(),
      ...overrides
    };
    dataSource.transaction.mockImplementation(
      (cb: (em: MockEm) => Promise<unknown>) => cb(em)
    );
    return em;
  }

  const percentRule = (percent: number) => ({
    type: 'percentage' as const,
    effect: 'include' as const,
    payload: { type: 'percentage' as const, percent }
  });

  describe('create', () => {
    it('rejects duplicate key with 409', async () => {
      flagRepo.findOne.mockResolvedValueOnce(sampleFlag);
      await expect(
        service.create({ key: sampleFlag.key }, 'actor-1')
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
        'actor-1'
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
        'actor-1'
      );
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
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
        service.create(
          { key: 'beta-export', rules: [percentRule(150)] },
          'actor-1'
        )
      ).rejects.toBeInstanceOf(HttpException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('maps a lost duplicate-key race to 409 with the flag-specific key', async () => {
      flagRepo.findOne.mockResolvedValueOnce(null); // duplicate check passes
      mockTransaction({
        save: jest.fn().mockRejectedValue({ code: '23505' })
      });

      await expect(
        service.create({ key: sampleFlag.key }, 'actor-1')
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
        service.create({ key: sampleFlag.key }, 'actor-1')
      ).rejects.toMatchObject({ status: 409 });
    });

    it('rethrows non-unique database errors untouched', async () => {
      flagRepo.findOne.mockResolvedValueOnce(null);
      mockTransaction({
        save: jest.fn().mockRejectedValue(new Error('connection reset'))
      });

      await expect(
        service.create({ key: sampleFlag.key }, 'actor-1')
      ).rejects.toThrow('connection reset');
    });
  });

  describe('update — optimistic lock', () => {
    it('returns 409 when version does not match (affected = 0)', async () => {
      flagRepo.findOne.mockResolvedValue(sampleFlag);
      const em = mockTransaction({
        createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder(0))
      });
      await expect(
        service.update(
          'flag-1',
          { enabled: true, rules: [percentRule(25)] },
          /* expected */ 999,
          'actor-1'
        )
      ).rejects.toMatchObject({ status: 409 });
      expect(em.delete).not.toHaveBeenCalled();
      expect(em.save).not.toHaveBeenCalled();
    });

    it('updates and increments version when match (affected = 1)', async () => {
      flagRepo.findOne
        .mockResolvedValueOnce(sampleFlag) // findOne preload
        .mockResolvedValueOnce({ ...sampleFlag, enabled: true, version: 2 }); // final findOne
      const qb = createQueryBuilder(1);
      const em = mockTransaction({
        createQueryBuilder: jest.fn().mockReturnValue(qb)
      });
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
      expect(em.delete).not.toHaveBeenCalled();
    });

    it('replaces the rules after the version-checked write', async () => {
      flagRepo.findOne.mockResolvedValue(sampleFlag);
      const qb = createQueryBuilder(1);
      const em = mockTransaction({
        createQueryBuilder: jest.fn().mockReturnValue(qb)
      });
      await service.update('flag-1', { rules: [] }, 1, 'actor-1');
      expect(qb.execute).toHaveBeenCalledTimes(1);
      expect(em.delete).toHaveBeenCalledWith(FeatureFlagRule, {
        flagId: 'flag-1'
      });
      expect(em.save).not.toHaveBeenCalled();
    });

    it('rejects an invalid rule payload before the transaction opens', async () => {
      flagRepo.findOne.mockResolvedValueOnce(sampleFlag);
      await expect(
        service.update('flag-1', { rules: [percentRule(150)] }, 1, 'actor-1')
      ).rejects.toBeInstanceOf(HttpException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('toggle — atomic flip', () => {
    type ToggleSetArg = {
      enabled: () => string;
      version: () => string;
      updatedByUserId: string | null;
    };
    const firstSetArg = (qb: QueryBuilderMock): ToggleSetArg => {
      const calls = qb.set.mock.calls as Array<[ToggleSetArg]>;
      return calls[0][0];
    };

    it('flips enabled and bumps version via a single SQL statement', async () => {
      const qb = createQueryBuilder(1);
      flagRepo.createQueryBuilder.mockReturnValue(qb);
      flagRepo.findOne.mockResolvedValueOnce({
        ...sampleFlag,
        enabled: true,
        version: 4
      });
      const result = await service.toggle('flag-1', 'actor-1');
      expect(flagRepo.update).not.toHaveBeenCalled();
      expect(qb.where).toHaveBeenCalledWith('id = :id', { id: 'flag-1' });
      const setArg = firstSetArg(qb);
      expect(typeof setArg.enabled).toBe('function');
      expect(setArg.enabled()).toBe('NOT enabled');
      expect(typeof setArg.version).toBe('function');
      expect(setArg.version()).toBe('version + 1');
      expect(setArg.updatedByUserId).toBe('actor-1');
      expect(result.enabled).toBe(true);
      expect(result.version).toBe(4);
    });

    it('throws 404 when flag does not exist (affected = 0)', async () => {
      const qb = createQueryBuilder(0);
      flagRepo.createQueryBuilder.mockReturnValue(qb);
      await expect(service.toggle('missing', 'actor-1')).rejects.toMatchObject({
        status: 404
      });
      expect(flagRepo.findOne).not.toHaveBeenCalled();
    });

    it('does not read flag.version into the app before writing (no stale read)', async () => {
      const qb = createQueryBuilder(1);
      flagRepo.createQueryBuilder.mockReturnValue(qb);
      flagRepo.findOne.mockResolvedValueOnce({
        ...sampleFlag,
        enabled: true,
        version: 99
      });
      await service.toggle('flag-1', 'actor-1');
      expect(flagRepo.findOne.mock.calls).toHaveLength(1);
      const setArg = firstSetArg(qb);
      expect(typeof setArg.version).toBe('function');
      expect(setArg.version()).toBe('version + 1');
    });

    it('two concurrent toggles each issue an atomic SQL flip (no lost update)', async () => {
      const qb1 = createQueryBuilder(1);
      const qb2 = createQueryBuilder(1);
      flagRepo.createQueryBuilder
        .mockReturnValueOnce(qb1)
        .mockReturnValueOnce(qb2);
      flagRepo.findOne
        .mockResolvedValueOnce({ ...sampleFlag, enabled: true, version: 6 })
        .mockResolvedValueOnce({ ...sampleFlag, enabled: false, version: 7 });
      const [a, b] = await Promise.all([
        service.toggle('flag-1', 'actor-A'),
        service.toggle('flag-1', 'actor-B')
      ]);
      expect(qb1.execute).toHaveBeenCalledTimes(1);
      expect(qb2.execute).toHaveBeenCalledTimes(1);
      for (const qb of [qb1, qb2]) {
        const setArg = firstSetArg(qb);
        expect(setArg.enabled()).toBe('NOT enabled');
        expect(setArg.version()).toBe('version + 1');
      }
      expect(a).toBeDefined();
      expect(b).toBeDefined();
    });
  });

  describe('preview', () => {
    const previewFlag = {
      ...sampleFlag,
      enabled: true,
      environments: ['production']
    };
    const previewRule = {
      id: 'r1',
      flagId: 'flag-1',
      type: 'role',
      effect: 'include',
      payload: { type: 'role', roleNames: ['beta'] }
    };

    it('evaluates against synthetic role context and returns included-by-rule', async () => {
      flagRepo.findOne.mockResolvedValueOnce(previewFlag);
      ruleRepo.find.mockResolvedValueOnce([previewRule]);
      const result = await service.preview('flag-1', { roles: ['beta'] });
      expect(result.result).toBe(true);
      expect(result.reason).toBe('included-by-rule');
      expect(result.matchedRule).toEqual({
        index: 0,
        type: 'role',
        effect: 'include'
      });
    });

    it('returns env-mismatch when synthetic env does not match the flag', async () => {
      flagRepo.findOne.mockResolvedValueOnce(previewFlag);
      ruleRepo.find.mockResolvedValueOnce([previewRule]);
      const result = await service.preview('flag-1', {
        roles: ['beta'],
        env: 'staging'
      });
      expect(result).toEqual({
        result: false,
        reason: 'env-mismatch',
        matchedRule: null
      });
    });

    it('falls back to ConfigService ENVIRONMENT when ctx.env is omitted', async () => {
      flagRepo.findOne.mockResolvedValueOnce(previewFlag);
      ruleRepo.find.mockResolvedValueOnce([previewRule]);
      await service.preview('flag-1', { roles: ['beta'] });
      expect(configService.get).toHaveBeenCalledWith('ENVIRONMENT');
    });

    it('throws 404 when the flag does not exist', async () => {
      flagRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.preview('missing', {})).rejects.toMatchObject({
        status: 404
      });
    });

    it('does not call save/update/remove (non-mutating)', async () => {
      flagRepo.findOne.mockResolvedValueOnce(previewFlag);
      ruleRepo.find.mockResolvedValueOnce([previewRule]);
      await service.preview('flag-1', { roles: ['beta'] });
      expect(flagRepo.save).not.toHaveBeenCalled();
      expect(flagRepo.update).not.toHaveBeenCalled();
      expect(flagRepo.remove).not.toHaveBeenCalled();
      expect(flagRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('caps the attribute key set to bound DTO abuse', async () => {
      flagRepo.findOne.mockResolvedValueOnce(previewFlag);
      ruleRepo.find.mockResolvedValueOnce([previewRule]);
      const huge: Record<string, unknown> = {};
      for (let i = 0; i < 100; i++) huge[`k${i}`] = i;
      const result = await service.preview('flag-1', {
        roles: ['beta'],
        attributes: huge
      });
      expect(result.result).toBe(true);
    });

    it('evaluates a supplied rule set instead of the persisted one', async () => {
      flagRepo.findOne.mockResolvedValueOnce(previewFlag);
      ruleRepo.find.mockResolvedValueOnce([previewRule]);
      const result = await service.preview('flag-1', {
        roles: ['beta'],
        rules: [
          {
            type: 'role',
            effect: 'include',
            payload: { type: 'role', roleNames: ['gamma'] }
          }
        ]
      });
      expect(result.result).toBe(false);
      expect(result.matchedRule).toBeNull();
    });

    it('matches a supplied rule the persisted set does not contain', async () => {
      flagRepo.findOne.mockResolvedValueOnce(previewFlag);
      ruleRepo.find.mockResolvedValueOnce([]);
      const result = await service.preview('flag-1', {
        roles: ['gamma'],
        rules: [
          {
            type: 'role',
            effect: 'include',
            payload: { type: 'role', roleNames: ['gamma'] }
          }
        ]
      });
      expect(result.result).toBe(true);
      expect(result.reason).toBe('included-by-rule');
      expect(result.matchedRule).toEqual({
        index: 0,
        type: 'role',
        effect: 'include'
      });
    });

    it('rejects a supplied rule payload the save path also rejects', async () => {
      flagRepo.findOne.mockResolvedValueOnce(previewFlag);
      ruleRepo.find.mockResolvedValueOnce([previewRule]);
      await expect(
        service.preview('flag-1', {
          rules: [
            {
              type: 'user',
              effect: 'include',
              // @ts-expect-error probing the runtime validator with a bad payload
              payload: { type: 'user', userIds: 'not-an-array' }
            }
          ]
        })
      ).rejects.toMatchObject({
        status: 400,
        response: {
          message: 'user rule requires userIds: an array of up to 100 UUIDs'
        }
      });
    });

    it('evaluates a supplied enabled flag state instead of the stored one', async () => {
      flagRepo.findOne.mockResolvedValueOnce(previewFlag);
      ruleRepo.find.mockResolvedValueOnce([previewRule]);
      const result = await service.preview('flag-1', {
        roles: ['beta'],
        enabled: false
      });
      expect(result).toEqual({
        result: false,
        reason: 'disabled',
        matchedRule: null
      });
    });

    it('evaluates a supplied environment list instead of the stored one', async () => {
      flagRepo.findOne.mockResolvedValueOnce(previewFlag);
      ruleRepo.find.mockResolvedValueOnce([previewRule]);
      const result = await service.preview('flag-1', {
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
    it('removes the given flag without loading it again', async () => {
      flagRepo.remove.mockResolvedValue({});
      await service.delete(sampleFlag);
      expect(flagRepo.findOne).not.toHaveBeenCalled();
      expect(flagRepo.remove).toHaveBeenCalledWith(sampleFlag);
    });
  });
});
