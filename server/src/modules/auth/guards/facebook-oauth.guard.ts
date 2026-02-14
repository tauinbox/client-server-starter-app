import type { ExecutionContext } from '@nestjs/common';
import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { firstValueFrom, isObservable } from 'rxjs';

@Injectable()
export class FacebookOAuthGuard extends AuthGuard('facebook') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const result = super.canActivate(context);
      if (isObservable(result)) return firstValueFrom(result);
      return await result;
    } catch {
      throw new NotFoundException('Facebook OAuth is not configured');
    }
  }
}
