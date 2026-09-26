import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  SerializeOptions,
  UseInterceptors
} from '@nestjs/common';
import { packRules } from '@casl/ability/extra';
import { subject } from '@casl/ability';
import { UsersService } from '../services/users.service';
import { MailService } from '../../mail/mail.service';
import { CreateUserDto } from '../dtos/create-user.dto';
import { UpdateUserDto } from '../dtos/update-user.dto';
import { SearchUsersCursorQueryDto } from '../dtos/search-users-cursor-query.dto';
import { PermissionService } from '../../auth/services/permission.service';
import { CaslAbilityFactory } from '../../auth/casl/casl-ability.factory';
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
import { AdminUserResponseDto } from '../dtos/admin-user-response.dto';
import { Authorize } from '../../auth/decorators/authorize.decorator';
import { CurrentAbility } from '../../auth/decorators/current-ability.decorator';
import { RegisterResource } from '../../auth/decorators/register-resource.decorator';
import type { AppAbility } from '../../auth/casl/app-ability';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserDeletedEvent } from '../events/user-deleted.event';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { assertCan } from '../../../common/utils/assert-can.util';
import { MetricsService } from '../../core/metrics/metrics.service';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import { JwtAuthRequest } from '../../auth/types/auth.request';
import { UserPasswordChangedByAdminEvent } from '../events/user-password-changed-by-admin.event';
import { UserSessionRevocationRequiredEvent } from '../events/user-session-revocation-required.event';
import { UserCreatedEvent } from '../events/user-created.event';
import { UserUpdatedEvent } from '../events/user-updated.event';
import { UserRestoredEvent } from '../events/user-restored.event';
import { User } from '../entities/user.entity';
import { AuthService } from '../../auth/services/auth.service';
import { CHALLENGE_THROTTLE } from '../../auth/constants/throttle.constants';
import { CountFailuresOnlyWhenBody } from '../../core/failure-counter.decorator';
import { ErrorKeys, STEP_UP_OPERATION } from '@app/shared/constants';
import { Throttle } from '@nestjs/throttler';
import { MfaService } from '../../auth/services/mfa.service';
import { MfaStepUpDto } from '../../auth/dtos/mfa.dto';

@ApiTags('Users API')
@Controller({
  path: 'users',
  version: '1'
})
@RegisterResource({ name: 'users', subject: 'User', displayName: 'Users' })
@UseInterceptors(ClassSerializerInterceptor)
@SerializeOptions({ groups: ['privileged'] })
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly eventEmitter: EventEmitter2,
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService,
    private readonly permissionService: PermissionService,
    private readonly caslAbilityFactory: CaslAbilityFactory,
    private readonly authService: AuthService,
    private readonly mfaService: MfaService
  ) {}

  @Post()
  @Authorize(['create', 'User'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new user (admin only)' })
  @ApiBody({ type: CreateUserDto })
  @ApiCreatedResponse({
    description: 'The user has been successfully created.',
    type: AdminUserResponseDto
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'User with this email already exists'
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  async create(
    @Body() createUserDto: CreateUserDto,
    @Request() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    // The route-level @Authorize check is type-level and ignores conditions,
    // so a conditional create grant is re-evaluated against the record the
    // caller is asking to create. The password is deliberately left out of the
    // subject: no authorization condition can legitimately be written over it.
    const { password: _password, ...subjectFields } = createUserDto;
    assertCan(
      ability,
      'create',
      subject('User', subjectFields),
      this.auditService,
      { actorId: req.user.userId, targetType: 'User' },
      this.metricsService
    );
    const createdUser = await this.usersService.create(createUserDto);
    await this.auditService.log({
      action: AuditAction.USER_CREATE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: createdUser.id,
      targetType: 'User',
      context: extractAuditContext(req)
    });
    this.eventEmitter.emit(
      UserCreatedEvent.name,
      new UserCreatedEvent(createdUser.id)
    );
    return createdUser;
  }

  @Get('cursor')
  @Authorize(['search', 'User'])
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get cursor-paginated list of users (admin only)'
  })
  @ApiOkResponse({
    description: 'Cursor-paginated list of users'
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  findAllCursor(
    @Query() query: SearchUsersCursorQueryDto,
    @CurrentAbility() ability: AppAbility
  ) {
    return this.usersService.findCursorPaginated(query, ability);
  }

  @Get('search/cursor')
  @Authorize(['search', 'User'])
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Search users with cursor pagination (admin only)'
  })
  @ApiOkResponse({
    description: 'Cursor-paginated list of filtered users'
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  searchUsersCursor(
    @Query() query: SearchUsersCursorQueryDto,
    @CurrentAbility() ability: AppAbility
  ) {
    return this.usersService.findCursorPaginated(query, ability);
  }

  @Get(':id')
  @Authorize(['read', 'User'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a user by ID (admin only)' })
  @ApiParam({ name: 'id', description: 'The user ID' })
  @ApiOkResponse({
    description: 'The user has been found',
    type: AdminUserResponseDto
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    const user = await this.usersService.findOne(id);
    assertCan(
      ability,
      'read',
      subject('User', user),
      this.auditService,
      { actorId: req.user.userId, targetId: id, targetType: 'User' },
      this.metricsService
    );
    return user;
  }

  @Get(':id/permissions')
  @Authorize(['read', 'User'])
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Get effective permissions for a user: roles, resolved DB permissions and compiled CASL rules (admin only)'
  })
  @ApiParam({ name: 'id', description: 'The user ID' })
  @ApiOkResponse({ description: 'Effective permissions for the user' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  async getPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: JwtAuthRequest,
    @CurrentAbility() callerAbility: AppAbility
  ) {
    const user = await this.usersService.findOne(id);
    assertCan(
      callerAbility,
      'read',
      subject('User', user),
      this.auditService,
      { actorId: req.user.userId, targetId: id, targetType: 'User' },
      this.metricsService
    );
    const [roleInfos, permissions] = await Promise.all([
      this.permissionService.getRolesForUser(id),
      this.permissionService.getPermissionsForUser(id)
    ]);
    const ability = await this.caslAbilityFactory.createForUser(
      id,
      roleInfos,
      permissions
    );
    return {
      roles: user.roles,
      permissions,
      rules: packRules(ability.rules)
    };
  }

  // A credential edit verifies a secret of the caller, so a refused attempt
  // costs the budget a refused sign-in costs. Only the long window is taken:
  // the per-minute limit of the challenge routes applies to every request,
  // and a name or status edit presents no secret.
  @Throttle({ 'login-long-window': CHALLENGE_THROTTLE['login-long-window'] })
  @CountFailuresOnlyWhenBody('currentPassword', 'code')
  @Patch(':id')
  @Authorize(['update', 'User'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a user (admin only)' })
  @ApiParam({ name: 'id', description: 'The user ID' })
  @ApiBody({ type: UpdateUserDto })
  @ApiOkResponse({
    description: 'The user has been successfully updated',
    type: AdminUserResponseDto
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Request() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    const { currentPassword, code, ...changes } = updateUserDto;

    // The ownership grant of the seeded `user` role reaches this route, and a
    // bare access token must not lock its owner out or lift a login lock.
    // Before the step-up, so a refused request spends no factor.
    if (
      id === req.user.userId &&
      (changes.isActive !== undefined || changes.unlockAccount !== undefined)
    ) {
      throw new HttpException(
        {
          message:
            'You cannot deactivate or unlock your own account. Ask another administrator.',
          errorKey: ErrorKeys.USERS.MODERATION_SELF
        },
        HttpStatus.BAD_REQUEST
      );
    }

    // The service rewrites the address only when it actually differs, so the
    // pre-image is the only way to tell a real change from a form resubmit -
    // and revoking on a resubmit would log the target out for nothing.
    let previousEmail: string | undefined;
    if (changes.email !== undefined || changes.password !== undefined) {
      const target = await this.usersService.findOne(id);
      if (changes.email !== undefined) {
        previousEmail = target.email;
      }
      if (changes.password !== undefined || changes.email !== target.email) {
        await this.assertCredentialStepUp(
          req,
          ability,
          target,
          currentPassword,
          code
        );
      }
    }

    const updatedUser = await this.usersService.update(
      id,
      changes,
      ability,
      req.user.userId
    );
    const emailChanged =
      previousEmail !== undefined && updatedUser.email !== previousEmail;
    const changedFields = Object.keys(changes).filter((k) => k !== 'password');
    await this.auditService.log({
      action: AuditAction.USER_UPDATE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: id,
      targetType: 'User',
      details: { changedFields },
      context: extractAuditContext(req)
    });

    if (changes.password) {
      this.eventEmitter.emit(
        UserPasswordChangedByAdminEvent.name,
        new UserPasswordChangedByAdminEvent(id)
      );
      await this.auditService.log({
        action: AuditAction.PASSWORD_CHANGE,
        actorId: req.user.userId,
        actorEmail: req.user.email,
        targetId: id,
        targetType: 'User',
        details: { source: 'admin' },
        context: extractAuditContext(req)
      });

      this.mailService
        .sendPasswordChangedNotification(
          updatedUser.email,
          'admin',
          updatedUser.locale,
          req.ip
        )
        .catch((err) =>
          this.logger.error('Failed to send password-changed notification', err)
        );
    }

    // The USER_UPDATE row above carries field names only, on purpose, so the
    // address the account moved to would otherwise be unrecoverable. This is
    // the administrator counterpart of the self-service confirm row, and
    // `source` is what separates the two.
    if (emailChanged) {
      await this.auditService.log({
        action: AuditAction.USER_EMAIL_CHANGE_COMPLETE,
        actorId: req.user.userId,
        actorEmail: req.user.email,
        targetId: id,
        targetType: 'User',
        details: {
          oldEmail: previousEmail,
          newEmail: updatedUser.email,
          source: 'admin'
        },
        context: extractAuditContext(req)
      });
    }

    // An admin email change exists to recover an account whose address is
    // attacker-controlled; leaving the holder's issued tokens alive would
    // defeat it. Mirrors the self-service confirm path, which revokes too.
    // Deactivation too: a surviving refresh row mints tokens on re-activation.
    if (changes.password || emailChanged || changes.isActive === false) {
      await this.eventEmitter.emitAsync(
        UserSessionRevocationRequiredEvent.name,
        new UserSessionRevocationRequiredEvent(id)
      );
    }

    this.eventEmitter.emit(UserUpdatedEvent.name, new UserUpdatedEvent(id));
    return updatedUser;
  }

  // For an owner who lost the authenticator and every recovery code. A self
  // target is refused: `POST /auth/mfa/disable` demands the owner's factor.
  @Throttle({ 'login-long-window': CHALLENGE_THROTTLE['login-long-window'] })
  @Post(':id/mfa/reset')
  @HttpCode(HttpStatus.OK)
  @Authorize(['update', 'User'])
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reset the two-factor enrolment of another user (admin only)'
  })
  @ApiParam({ name: 'id', description: 'The user ID' })
  @ApiBody({ type: MfaStepUpDto })
  @ApiOkResponse({
    description: 'Two-factor has been reset and every session ended',
    type: AdminUserResponseDto
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  async resetMfa(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MfaStepUpDto,
    @Request() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    if (id === req.user.userId) {
      throw new HttpException(
        {
          message:
            'Turn off your own two-factor authentication from your profile',
          errorKey: ErrorKeys.USERS.MFA_RESET_SELF
        },
        HttpStatus.BAD_REQUEST
      );
    }

    const target = await this.usersService.findOne(id);
    // Before the step-up, so a request refused anyway spends no code; the
    // instance check leads so an outsider cannot probe for the factor.
    this.usersService.assertCanWrite(
      ability,
      'update',
      target,
      req.user.userId
    );
    if (!target.mfaEnabled) {
      throw new HttpException(
        {
          message: 'Two-factor authentication is not enabled',
          errorKey: ErrorKeys.AUTH.MFA_NOT_ENABLED
        },
        HttpStatus.BAD_REQUEST
      );
    }
    await this.assertCredentialStepUp(
      req,
      ability,
      target,
      dto.currentPassword,
      dto.code
    );

    await this.mfaService.resetByAdmin(
      target,
      { id: req.user.userId, email: req.user.email },
      extractAuditContext(req)
    );

    // The sessions were opened with the factor the owner no longer holds, and
    // one of them may be the reason the owner asked for a reset.
    await this.eventEmitter.emitAsync(
      UserSessionRevocationRequiredEvent.name,
      new UserSessionRevocationRequiredEvent(id)
    );
    this.eventEmitter.emit(UserUpdatedEvent.name, new UserUpdatedEvent(id));
    return this.usersService.findOne(id);
  }

  // No step-up: the same permission deactivates the account without one, and
  // a deactivation ends the sessions too. A self target is refused: it would
  // sign the caller out, and `DELETE /auth/sessions` keeps this device.
  @Post(':id/sessions/revoke')
  @HttpCode(HttpStatus.OK)
  @Authorize(['update', 'User'])
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'End every session of another user (admin only)'
  })
  @ApiParam({ name: 'id', description: 'The user ID' })
  @ApiOkResponse({ description: 'Every session of the user has ended' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  async revokeSessions(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ): Promise<{ message: string }> {
    if (id === req.user.userId) {
      throw new HttpException(
        {
          message: 'End your own sessions from your profile',
          errorKey: ErrorKeys.USERS.SESSION_REVOKE_SELF
        },
        HttpStatus.BAD_REQUEST
      );
    }

    const target = await this.usersService.findOne(id);
    this.usersService.assertCanWrite(
      ability,
      'update',
      target,
      req.user.userId
    );

    await this.eventEmitter.emitAsync(
      UserSessionRevocationRequiredEvent.name,
      new UserSessionRevocationRequiredEvent(id)
    );
    await this.auditService.log({
      action: AuditAction.SESSION_REVOKE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: id,
      targetType: 'User',
      details: { scope: 'all', source: 'admin' },
      context: extractAuditContext(req)
    });
    return { message: 'Every session of the user has ended' };
  }

  /**
   * A stolen access token must not set a password or move the address of any
   * account, the caller's own included, so the factor is the CALLER's. The
   * instance check runs first: a request refused anyway must not spend a
   * single-use code or the step-up budget of the caller.
   *
   * The provider proof cookie is not accepted here, so an actor with neither a
   * password nor an authenticator is refused and sets one on its profile
   * first.
   */
  private async assertCredentialStepUp(
    req: JwtAuthRequest,
    ability: AppAbility,
    target: User,
    currentPassword: string | undefined,
    code: string | undefined
  ): Promise<void> {
    this.usersService.assertCanWrite(
      ability,
      'update',
      target,
      req.user.userId
    );
    await this.authService.assertStepUp(
      await this.usersService.findOne(req.user.userId),
      currentPassword,
      undefined,
      STEP_UP_OPERATION.USER_CREDENTIAL_CHANGE,
      code,
      extractAuditContext(req)
    );
  }

  @Delete(':id')
  @Authorize(['delete', 'User'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft-delete a user (admin only)' })
  @ApiParam({ name: 'id', description: 'The user ID' })
  @ApiOkResponse({ description: 'The user has been successfully deleted' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    const user = await this.usersService.findOne(id);
    await this.usersService.remove(id, ability, req.user.userId);
    this.eventEmitter.emit(UserDeletedEvent.name, new UserDeletedEvent(id));
    await this.auditService.log({
      action: AuditAction.USER_DELETE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: id,
      targetType: 'User',
      details: { targetEmail: user.email },
      context: extractAuditContext(req)
    });
    await this.eventEmitter.emitAsync(
      UserSessionRevocationRequiredEvent.name,
      new UserSessionRevocationRequiredEvent(id)
    );
    return {};
  }

  @Post(':id/restore')
  @Authorize(['delete', 'User'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Restore a soft-deleted user (admin only)' })
  @ApiParam({ name: 'id', description: 'The user ID' })
  @ApiOkResponse({
    description: 'The user has been successfully restored',
    type: AdminUserResponseDto
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  async restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    const restoredUser = await this.usersService.restore(
      id,
      ability,
      req.user.userId
    );
    await this.auditService.log({
      action: AuditAction.USER_RESTORE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: id,
      targetType: 'User',
      details: { targetEmail: restoredUser.email },
      context: extractAuditContext(req)
    });
    this.eventEmitter.emit(UserRestoredEvent.name, new UserRestoredEvent(id));
    return restoredUser;
  }
}
