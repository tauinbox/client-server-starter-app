import { HttpException, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../services/auth.service';
import { UserResponseDto } from '../../users/dtos/user-response.dto';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({ usernameField: 'email' });
  }

  async validate(email: string, password: string): Promise<UserResponseDto> {
    try {
      return await this.authService.validateUser(email, password);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw error;
    }
  }
}
