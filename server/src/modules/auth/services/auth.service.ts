import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../../users/services/users.service';
import { RegisterDto } from '../dtos/register.dto';
import { User } from '../../users/entities/user.entity';
import { UserResponseDto } from '../../users/dtos/user-response.dto';

import { CustomJwtPayload } from '../types/jwt-payload';
import { LocalAuthRequest } from '../types/auth.request';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async validateUser(
    email: string,
    password: string,
  ): Promise<UserResponseDto | null> {
    const user = await this.usersService.findByEmail(email);
    if (user && (await bcrypt.compare(password, user.password))) {
      const { password, ...result } = user;

      return result;
    }

    return null;
  }

  async login(user: LocalAuthRequest['user']) {
    const payload: CustomJwtPayload = {
      email: user.email,
      sub: user.id,
      isAdmin: user.isAdmin,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user,
    };
  }

  async register(registerDto: RegisterDto): Promise<User> {
    return this.usersService.create(registerDto);
  }
}
