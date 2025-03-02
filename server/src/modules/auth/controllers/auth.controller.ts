import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { LocalAuthGuard } from '../guards/local-auth.guard';
import { AuthService } from '../services/auth.service';
import { RegisterDto } from '../dtos/register.dto';
import { UserResponseDto } from '../../users/dtos/user-response.dto';
import { LoginDto } from '../dtos/login.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { UsersService } from '../../users/services/users.service';
import { AuthResponseDto } from '../dtos/auth-response.dto';
import { JwtAuthRequest, LocalAuthRequest } from '../types/auth.request';

@ApiTags('Auth API')
@Controller({
  path: 'auth',
  version: '1',
})
@UseInterceptors(ClassSerializerInterceptor)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UsersService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({
    description: 'User has been successfully registered',
    type: UserResponseDto,
  })
  @ApiConflictResponse({ description: 'User with this email already exists' })
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    description: 'User has been successfully logged in',
    type: AuthResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  login(@Request() req: LocalAuthRequest) {
    return this.authService.login(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current user profile' })
  @ApiOkResponse({
    description: 'Current user profile',
    type: UserResponseDto, // TODO: replace with profile data
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getProfile(@Request() req: JwtAuthRequest) {
    return await this.userService.findOne(req.user.userId);
    // TODO: replace with profile data
  }
}
