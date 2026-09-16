import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { LocalStrategy } from './local.strategy';
import { MAX_PASSWORD_LENGTH } from '@app/shared/constants';
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

    it('collapses an address over 255 characters to an ordinary failed credential', async () => {
      const address = `${'a'.repeat(250)}@x.com`;
      expect(address).toHaveLength(256);

      await strategy.validate(address, 'Password1');

      expect(authServiceMock.validateUser).toHaveBeenCalledWith(
        '',
        'Password1'
      );
    });

    it('keeps an address of exactly 255 characters', async () => {
      const address = `${'a'.repeat(249)}@x.com`;

      await strategy.validate(address, 'Password1');

      expect(authServiceMock.validateUser).toHaveBeenCalledWith(
        address,
        'Password1'
      );
    });

    it(`collapses a password over ${MAX_PASSWORD_LENGTH} characters to an ordinary failed credential`, async () => {
      await strategy.validate(
        'test@example.com',
        'a'.repeat(MAX_PASSWORD_LENGTH + 1)
      );

      expect(authServiceMock.validateUser).toHaveBeenCalledWith(
        'test@example.com',
        ''
      );
    });

    // The anti-lockout case: `@MaxLength` counts a surrogate pair as one
    // character, so a password of 128 emoji passed the DTO when it was set.
    it(`keeps a password of ${MAX_PASSWORD_LENGTH} astral characters`, async () => {
      const password = '\u{1F600}'.repeat(MAX_PASSWORD_LENGTH);
      expect(password.length).toBeGreaterThan(MAX_PASSWORD_LENGTH);

      await strategy.validate('test@example.com', password);

      expect(authServiceMock.validateUser).toHaveBeenCalledWith(
        'test@example.com',
        password
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
