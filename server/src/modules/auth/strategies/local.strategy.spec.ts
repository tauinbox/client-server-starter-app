import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { LocalStrategy } from './local.strategy';
import { AuthService } from '../services/auth.service';
import type { UserResponseDto } from '../../users/dtos/user-response.dto';

describe('LocalStrategy', () => {
  let strategy: LocalStrategy;
  let authServiceMock: { validateUser: jest.Mock };

  const mockUser: Partial<UserResponseDto> = {
    id: 'user-1',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User'
  };

  beforeEach(async () => {
    authServiceMock = {
      validateUser: jest.fn().mockResolvedValue(mockUser)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocalStrategy,
        { provide: AuthService, useValue: authServiceMock }
      ]
    }).compile();

    strategy = module.get<LocalStrategy>(LocalStrategy);
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate', () => {
    it('should return user when credentials are valid', async () => {
      const result = await strategy.validate('test@example.com', 'Password1');

      expect(authServiceMock.validateUser).toHaveBeenCalledWith(
        'test@example.com',
        'Password1'
      );
      expect(result).toBe(mockUser);
    });

    // Login has no DTO (guards run before pipes), so the strategy is the only
    // place the raw body can be canonicalized.
    it('lowercases and trims the address before the lookup', async () => {
      await strategy.validate('  Test@Example.COM ', 'Password1');

      expect(authServiceMock.validateUser).toHaveBeenCalledWith(
        'test@example.com',
        'Password1'
      );
    });

    it('collapses a non-string email to an ordinary failed credential', async () => {
      await strategy.validate({ $ne: null }, 'Password1');

      expect(authServiceMock.validateUser).toHaveBeenCalledWith(
        '',
        'Password1'
      );
    });

    it('collapses a non-string password to an ordinary failed credential', async () => {
      await strategy.validate('test@example.com', { $ne: null });

      expect(authServiceMock.validateUser).toHaveBeenCalledWith(
        'test@example.com',
        ''
      );
    });

    it('should rethrow HttpException from authService', async () => {
      authServiceMock.validateUser.mockRejectedValue(
        new UnauthorizedException('Invalid credentials')
      );

      await expect(
        strategy.validate('bad@example.com', 'wrong')
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should rethrow non-HttpException errors', async () => {
      authServiceMock.validateUser.mockRejectedValue(new Error('DB error'));

      await expect(
        strategy.validate('test@example.com', 'pass')
      ).rejects.toThrow('DB error');
    });
  });
});
