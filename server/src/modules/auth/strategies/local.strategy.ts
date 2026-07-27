import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { normalizeEmail } from '@app/shared/utils/email';
import { AuthService } from '../services/auth.service';
import { UserResponseDto } from '../../users/dtos/user-response.dto';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({ usernameField: 'email' });
  }

  /**
   * The login route has no `@Body()` DTO and guards run before pipes, so
   * passport reads the raw request body: this is the only place credentials
   * can be canonicalized before the lookup. Non-strings collapse to the empty
   * string so a malformed body stays on the ordinary invalid-credentials path
   * (401, audited, constant-time) rather than being handed to the repository
   * as a raw object whose handling is the driver's business.
   */
  async validate(email: unknown, password: unknown): Promise<UserResponseDto> {
    return this.authService.validateUser(
      normalizeEmail(email) ?? '',
      typeof password === 'string' ? password : ''
    );
  }
}
