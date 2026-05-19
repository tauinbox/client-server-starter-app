import {
  ClassSerializerInterceptor,
  Controller,
  Get,
  Req,
  UseInterceptors
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { PermissionService } from '../../auth/services/permission.service';
import { UsersService } from '../../users/services/users.service';
import {
  FeatureFlagResolverService,
  type ResolverUser
} from '../services/feature-flag-resolver.service';
import { EvaluateFlagsResponseDto } from '../dtos/evaluate-flags-response.dto';
import { ANON_ID_COOKIE } from '../middleware/anon-id.middleware';

type RequestWithUser = Request & {
  user?: { userId?: string; email?: string };
};

@ApiTags('Feature Flags API')
@Controller({
  path: 'feature-flags',
  version: '1'
})
@UseInterceptors(ClassSerializerInterceptor)
export class FeatureFlagsController {
  constructor(
    private readonly resolver: FeatureFlagResolverService,
    private readonly permissionService: PermissionService,
    private readonly usersService: UsersService
  ) {}

  @Get()
  @Public()
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Evaluate feature flags for the caller. Authenticated → all flags; anonymous → public flags only.'
  })
  @ApiOkResponse({ type: EvaluateFlagsResponseDto })
  async evaluate(@Req() req: RequestWithUser) {
    const userId = req.user?.userId;
    if (userId) {
      const [user, roles] = await Promise.all([
        this.usersService.findOne(userId).catch(() => null),
        this.permissionService.getRoleNamesForUser(userId)
      ]);
      const resolverUser: ResolverUser = {
        userId,
        email: user?.email ?? null,
        createdAt: user?.createdAt ?? null,
        roles
      };
      return this.resolver.evaluateForUser(resolverUser, req);
    }
    const cookies = (req.cookies ?? {}) as Record<string, unknown>;
    const cookieValue = cookies[ANON_ID_COOKIE];
    const anonId = typeof cookieValue === 'string' ? cookieValue : null;
    return this.resolver.evaluateAnonymous(anonId, req);
  }
}
