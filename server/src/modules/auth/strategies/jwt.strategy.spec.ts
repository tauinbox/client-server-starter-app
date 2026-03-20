import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { JwtStrategy } from './jwt.strategy';
import { CustomJwtPayload } from '../types/jwt-payload';

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
          useValue: {
            getOrThrow: jest.fn().mockReturnValue('test-secret')
          }
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
        new UnauthorizedException('User not found')
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
        new UnauthorizedException('Token has been revoked')
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
  });
});
