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
import { ConfigService } from '@nestjs/config';
import { requiresSecureCookies } from '@app/shared/constants';
import { readHostCookie } from '../../../common/utils/host-cookie';
import { OptionalAuth } from '../../auth/decorators/optional-auth.decorator';
import { FeatureFlagResolverService } from '../services/feature-flag-resolver.service';
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
    private readonly configService: ConfigService
  ) {}

  @Get()
  @OptionalAuth()
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Evaluate feature flags for the caller. Authenticated → all flags; anonymous → public flags only.'
  })
  @ApiOkResponse({ type: EvaluateFlagsResponseDto })
  async evaluate(@Req() req: RequestWithUser) {
    const userId = req.user?.userId;
    if (userId) {
      const resolverUser = await this.resolver.buildResolverUser(userId);
      return this.resolver.evaluateForUser(resolverUser, req);
    }
    const anonId =
      readHostCookie(
        req,
        ANON_ID_COOKIE,
        requiresSecureCookies(this.configService.get<string>('ENVIRONMENT'))
      ) ?? null;
    return this.resolver.evaluateAnonymous(anonId, req);
  }
}
