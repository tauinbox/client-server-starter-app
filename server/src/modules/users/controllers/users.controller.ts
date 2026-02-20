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
  UseInterceptors
} from '@nestjs/common';
import { UsersService } from '../services/users.service';
import { CreateUserDto } from '../dtos/create-user.dto';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UpdateUserDto } from '../dtos/update-user.dto';
import { SearchUsersQueryDto } from '../dtos/search-users-query.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';
import { UserResponseDto } from '../dtos/user-response.dto';
import { RolesEnum } from '../../auth/enums/roles.enum';

@ApiTags('Users API')
@Controller({
  path: 'users',
  version: '1'
})
@UseInterceptors(ClassSerializerInterceptor)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolesEnum.Admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new user (admin only)' })
  @ApiBody({ type: CreateUserDto })
  @ApiCreatedResponse({
    description: 'The user has been successfully created.',
    type: UserResponseDto
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'User with this email already exists'
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - requires admin role' })
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolesEnum.Admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get paginated list of users (admin only)' })
  @ApiOkResponse({
    description: 'Paginated list of users'
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - requires admin role' })
  findAll(@Query() query: SearchUsersQueryDto) {
    return this.usersService.findPaginated(query);
  }

  @Get('search')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolesEnum.Admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search users by criteria (admin only)' })
  @ApiOkResponse({
    description: 'Paginated list of filtered users'
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - requires admin role' })
  searchUsers(@Query() query: SearchUsersQueryDto) {
    return this.usersService.findPaginated(query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolesEnum.Admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a user by ID (admin only)' })
  @ApiParam({ name: 'id', description: 'The user ID' })
  @ApiOkResponse({
    description: 'The user has been found',
    type: UserResponseDto
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - requires admin role' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolesEnum.Admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a user (admin only)' })
  @ApiParam({ name: 'id', description: 'The user ID' })
  @ApiBody({ type: UpdateUserDto })
  @ApiOkResponse({
    description: 'The user has been successfully updated',
    type: UserResponseDto
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - requires admin role' })
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
