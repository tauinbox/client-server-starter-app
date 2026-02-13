import type { ExecutionContext } from '@nestjs/common';
import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  canActivate(context: ExecutionContext) {
    try {
      return super.canActivate(context);
    } catch {
      throw new NotFoundException('Google OAuth is not configured');
    }
  }
}
