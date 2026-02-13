import type { ExecutionContext } from '@nestjs/common';
import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class FacebookOAuthGuard extends AuthGuard('facebook') {
  canActivate(context: ExecutionContext) {
    try {
      return super.canActivate(context);
    } catch {
      throw new NotFoundException('Facebook OAuth is not configured');
    }
  }
}
