import type { ExecutionContext } from '@nestjs/common';
import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class VkOAuthGuard extends AuthGuard('vkontakte') {
  canActivate(context: ExecutionContext) {
    try {
      return super.canActivate(context);
    } catch {
      throw new NotFoundException('VK OAuth is not configured');
    }
  }
}
