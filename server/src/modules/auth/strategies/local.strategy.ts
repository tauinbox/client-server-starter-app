import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { maxLength } from 'class-validator';
import { Strategy } from 'passport-local';
import { normalizeEmail } from '@app/shared/utils/email';
import { MAX_PASSWORD_LENGTH } from '@app/shared/constants';
import { AuthService } from '../services/auth.service';
import { UserResponseDto } from '../../users/dtos/user-response.dto';

// The caps `LoginDto` declares. That class only documents the route, so the
// pipe never applies them.
const MAX_EMAIL_LENGTH = 255;

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({ usernameField: 'email' });
  }

  /**
   * The login route has no `@Body()` DTO and guards run before pipes, so
   * passport reads the raw request body: this is the only place credentials
   * can be canonicalized before the lookup. Non-strings and values over the
   * `LoginDto` caps collapse to the empty string, so a malformed body stays on
   * the ordinary invalid-credentials path (401, audited, constant-time) rather
   * than being handed to the repository, or written to the audit log, as is.
   * A 400 here would break the recorded 401 contract of the route.
   *
   * `maxLength` is the check `@MaxLength` runs. It counts a surrogate pair as
   * one character, so a stored password that passed the DTO still fits.
   */
  async validate(email: unknown, password: unknown): Promise<UserResponseDto> {
    const address = normalizeEmail(email) ?? '';
    return this.authService.validateUser(
      maxLength(address, MAX_EMAIL_LENGTH) ? address : '',
      typeof password === 'string' && maxLength(password, MAX_PASSWORD_LENGTH)
        ? password
        : ''
    );
  }
}
