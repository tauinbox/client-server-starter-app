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
