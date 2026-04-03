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
 * @Patch(':id')
 * @Authorize(['update', 'User'])
 * async update(
 *   @Param('id') id: string,
 *   @Body() dto: UpdateUserDto,
 *   @CurrentAbility() ability: AppAbility,
 * ) {
 *   return this.usersService.update(id, dto, ability);
 * }
 *
 * In the service:
 *   const user = await this.repo.findOneBy({ id });
 *   if (!ability.can('update', user)) throw new ForbiddenException();
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
