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
  Request,
  UseInterceptors
} from '@nestjs/common';
import { UsersService } from '../services/users.service';
import { CreateUserDto } from '../dtos/create-user.dto';
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
import { Authorize } from '../../auth/decorators/authorize.decorator';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import { JwtAuthRequest } from '../../auth/types/auth.request';

@ApiTags('Users API')
@Controller({
  path: 'users',
  version: '1'
})
@UseInterceptors(ClassSerializerInterceptor)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService
  ) {}

  @Post()
  @Authorize(['create', 'User'])
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
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  async create(
    @Body() createUserDto: CreateUserDto,
    @Request() req: JwtAuthRequest
  ) {
    const createdUser = await this.usersService.create(createUserDto);
    await this.auditService.log({
      action: AuditAction.USER_CREATE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: createdUser.id,
      targetType: 'User',
      context: extractAuditContext(req)
    });
    return createdUser;
  }

  @Get()
  @Authorize(['list', 'User'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get paginated list of users (admin only)' })
  @ApiOkResponse({
    description: 'Paginated list of users'
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  findAll(@Query() query: SearchUsersQueryDto) {
    return this.usersService.findPaginated(query);
  }

  @Get('search')
  @Authorize(['search', 'User'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search users by criteria (admin only)' })
  @ApiOkResponse({
    description: 'Paginated list of filtered users'
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  searchUsers(@Query() query: SearchUsersQueryDto) {
    return this.usersService.findPaginated(query);
  }

  @Get(':id')
  @Authorize(['read', 'User'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a user by ID (admin only)' })
  @ApiParam({ name: 'id', description: 'The user ID' })
  @ApiOkResponse({
    description: 'The user has been found',
    type: UserResponseDto
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @Authorize(['update', 'User'])
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
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Request() req: JwtAuthRequest
  ) {
    const updatedUser = await this.usersService.update(id, updateUserDto);
    const changedFields = Object.keys(updateUserDto).filter(
      (k) => k !== 'password'
    );
    await this.auditService.log({
      action: AuditAction.USER_UPDATE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: id,
      targetType: 'User',
      details: { changedFields },
      context: extractAuditContext(req)
    });

    if (updateUserDto.password) {
      await this.auditService.log({
        action: AuditAction.PASSWORD_CHANGE,
        actorId: req.user.userId,
        actorEmail: req.user.email,
        targetId: id,
        targetType: 'User',
        details: { source: 'admin' },
        context: extractAuditContext(req)
      });
    }

    return updatedUser;
  }

  @Delete(':id')
  @Authorize(['delete', 'User'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a user (admin only)' })
  @ApiParam({ name: 'id', description: 'The user ID' })
  @ApiOkResponse({ description: 'The user has been successfully deleted' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  async remove(@Param('id') id: string, @Request() req: JwtAuthRequest) {
    const user = await this.usersService.findOne(id);
    const result = await this.usersService.remove(id);
    await this.auditService.log({
      action: AuditAction.USER_DELETE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: id,
      targetType: 'User',
      details: { targetEmail: user.email },
      context: extractAuditContext(req)
    });
    return result;
  }
}
