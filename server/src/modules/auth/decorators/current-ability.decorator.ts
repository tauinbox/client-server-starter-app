import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AppAbility } from '../casl/app-ability';
import type { JwtAuthRequest } from '../types/auth.request';

/**
 * Extracts the CASL ability built by PermissionsGuard from the current request.
 *
 * Use in controller methods protected by @Authorize() to perform instance-level
 * checks in the service layer after loading the resource from the database:
 *
 * @example
 * @Get(':id')
 * @Authorize(['read', 'User'])
 * findOne(
 *   @Param('id', ParseUUIDPipe) id: string,
 *   @Request() req: JwtAuthRequest,
 *   @CurrentAbility() ability: AppAbility,
 * ) {
 *   return this.usersService.findOne(id, ability, req.user.userId);
 * }
 *
 * In the service, which takes `ability: AbilityOrSystem`:
 *   const user = await this.loadUser(id);
 *   if (ability !== SYSTEM_ABILITY) {
 *     assertCan(ability, 'read', subject('User', user), this.auditService,
 *       { actorId, targetId: id, targetType: 'User' }, this.metricsService);
 *   }
 *
 * NOTE: Returns undefined when the route is not protected by @Authorize()
 * (PermissionsGuard did not run and ability was not attached to the request).
 */
export const CurrentAbility = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AppAbility | undefined => {
    const req = ctx.switchToHttp().getRequest<JwtAuthRequest>();
    return req.ability;
  }
);
