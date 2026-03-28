import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { JwtStrategy } from './jwt.strategy';
import { CustomJwtPayload } from '../types/jwt-payload';

function buildConfigService(overrides: Record<string, unknown> = {}): {
  get: jest.Mock;
  getOrThrow: jest.Mock;
} {
  const values: Record<string, unknown> = {
    JWT_ALGORITHM: 'HS256',
    JWT_SECRET: 'test-secret',
    JWT_MIN_IAT: undefined,
    ...overrides
  };
  return {
    get: jest.fn().mockImplementation((key: string) => values[key]),
    getOrThrow: jest.fn().mockImplementation((key: string) => {
      if (values[key] === undefined) throw new Error(`Missing: ${key}`);
      return values[key];
    })
  };
}

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let mockRepository: {
    findOne: jest.Mock;
  };
  let mockDataSource: {
    getRepository: jest.Mock;
  };

  beforeEach(async () => {
    mockRepository = {
      findOne: jest.fn()
    };

    mockDataSource = {
      getRepository: jest.fn().mockReturnValue(mockRepository)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: buildConfigService()
        },
        { provide: DataSource, useValue: mockDataSource }
      ]
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate', () => {
    const basePayload: CustomJwtPayload = {
      sub: 'user-1',
      email: 'test@example.com',
      roles: ['user'],
      iat: Math.floor(Date.now() / 1000) - 60, // issued 60 seconds ago
      exp: Math.floor(Date.now() / 1000) + 3540
    };

    it('should return PayloadFromJwt when token is valid and not revoked', async () => {
      mockRepository.findOne.mockResolvedValue({
        id: 'user-1',
        tokenRevokedAt: null
      });

      const result = await strategy.validate(basePayload);

      expect(result).toEqual({
        userId: 'user-1',
        email: 'test@example.com',
        roles: ['user']
      });
      expect(mockDataSource.getRepository).toHaveBeenCalled();
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: ['id', 'tokenRevokedAt']
      });
    });

    it('should throw UnauthorizedException when user not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(strategy.validate(basePayload)).rejects.toThrow(
        HttpException
      );
    });

    it('should throw UnauthorizedException when token was issued before revocation time', async () => {
      const revokedAt = new Date(
        (basePayload.iat! + 30) * 1000 // revoked 30 seconds after token was issued
      );
      mockRepository.findOne.mockResolvedValue({
        id: 'user-1',
        tokenRevokedAt: revokedAt
      });

      await expect(strategy.validate(basePayload)).rejects.toThrow(
        HttpException
      );
    });

    it('should pass when token was issued after revocation time', async () => {
      const revokedAt = new Date(
        (basePayload.iat! - 30) * 1000 // revoked 30 seconds before token was issued
      );
      mockRepository.findOne.mockResolvedValue({
        id: 'user-1',
        tokenRevokedAt: revokedAt
      });

      const result = await strategy.validate(basePayload);

      expect(result).toEqual({
        userId: 'user-1',
        email: 'test@example.com',
        roles: ['user']
      });
    });

    it('should default roles to empty array when payload has no roles', async () => {
      mockRepository.findOne.mockResolvedValue({
        id: 'user-1',
        tokenRevokedAt: null
      });

      const payloadWithoutRoles: CustomJwtPayload = {
        sub: 'user-1',
        email: 'test@example.com',
        iat: basePayload.iat,
        exp: basePayload.exp
      };

      const result = await strategy.validate(payloadWithoutRoles);

      expect(result.roles).toEqual([]);
    });

    describe('JWT_MIN_IAT rotation check (SRV-12)', () => {
      let rotationStrategy: JwtStrategy;

      beforeEach(async () => {
        // minIat = iat + 10 → token is 10 seconds too old
        const minIat = basePayload.iat! + 10;
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            JwtStrategy,
            {
              provide: ConfigService,
              useValue: buildConfigService({ JWT_MIN_IAT: minIat })
            },
            { provide: DataSource, useValue: mockDataSource }
          ]
        }).compile();
        rotationStrategy = module.get<JwtStrategy>(JwtStrategy);
      });

      it('should throw UnauthorizedException when token was issued before JWT_MIN_IAT', async () => {
        await expect(rotationStrategy.validate(basePayload)).rejects.toThrow(
          HttpException
        );
      });

      it('should pass when token was issued at or after JWT_MIN_IAT', async () => {
        mockRepository.findOne.mockResolvedValue({
          id: 'user-1',
          tokenRevokedAt: null
        });
        // minIat = iat - 10 → token is newer than the rotation boundary
        const minIat = basePayload.iat! - 10;
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            JwtStrategy,
            {
              provide: ConfigService,
              useValue: buildConfigService({ JWT_MIN_IAT: minIat })
            },
            { provide: DataSource, useValue: mockDataSource }
          ]
        }).compile();
        const freshStrategy = module.get<JwtStrategy>(JwtStrategy);

        const result = await freshStrategy.validate(basePayload);
        expect(result.userId).toBe('user-1');
      });

      it('should skip rotation check when JWT_MIN_IAT is not set', async () => {
        mockRepository.findOne.mockResolvedValue({
          id: 'user-1',
          tokenRevokedAt: null
        });
        // strategy from outer beforeEach has JWT_MIN_IAT=undefined
        const result = await strategy.validate(basePayload);
        expect(result.userId).toBe('user-1');
      });
    });
  });
});
