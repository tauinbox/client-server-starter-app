import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { UsersService } from '../services/users.service';
import { CreateUserDto } from '../dtos/create-user.dto';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UpdateUserDto } from '../dtos/update-user.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserResponseDto } from '../dtos/user-response.dto';
import { RolesEnum } from '../../auth/enums/roles.enum';

@ApiTags('Users API')
@Controller({
  path: 'users',
  version: '1',
})
@UseInterceptors(ClassSerializerInterceptor)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new user' })
  @ApiBody({ type: CreateUserDto })
  @ApiCreatedResponse({
    description: 'The user has been successfully created.',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'User with this email already exists',
  })
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolesEnum.Admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all users (admin only)' })
  @ApiOkResponse({
    description: 'List of all users',
    type: [UserResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - requires admin role' })
  findAll() {
    return this.usersService.findAll();
  }

  @Get('search')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolesEnum.Admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search users by criteria (admin only)' })
  @ApiQuery({ name: 'email', required: false, description: 'Filter by email' })
  @ApiQuery({
    name: 'firstName',
    required: false,
    description: 'Filter by first name',
  })
  @ApiQuery({
    name: 'lastName',
    required: false,
    description: 'Filter by last name',
  })
  @ApiQuery({
    name: 'isAdmin',
    required: false,
    description: 'Filter by admin status',
    type: Boolean,
  })
  @ApiQuery({
    name: 'isActive',
    required: false,
    description: 'Filter by active status',
    type: Boolean,
  })
  @ApiOkResponse({
    description: 'List of filtered users',
    type: [UserResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - requires admin role' })
  searchUsers(
    @Query('email') email?: string,
    @Query('firstName') firstName?: string,
    @Query('lastName') lastName?: string,
    @Query('isAdmin') isAdmin?: boolean,
    @Query('isActive') isActive?: boolean,
  ) {
    return this.usersService.searchUsers({
      email,
      firstName,
      lastName,
      isAdmin,
      isActive,
    });
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiParam({ name: 'id', description: 'The user ID' })
  @ApiOkResponse({
    description: 'The user has been found',
    type: UserResponseDto,
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a user' })
  @ApiParam({ name: 'id', description: 'The user ID' })
  @ApiBody({ type: UpdateUserDto })
  @ApiOkResponse({
    description: 'The user has been successfully updated',
    type: UserResponseDto,
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolesEnum.Admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a user (admin only)' })
  @ApiParam({ name: 'id', description: 'The user ID' })
  @ApiOkResponse({ description: 'The user has been successfully deleted' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - requires admin role' })
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
