import type { ExecutionContext } from '@nestjs/common';
import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { firstValueFrom, isObservable } from 'rxjs';

@Injectable()
export class VkOAuthGuard extends AuthGuard('vkontakte') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const result = super.canActivate(context);
      if (isObservable(result)) return firstValueFrom(result);
      return await result;
    } catch {
      throw new NotFoundException('VK OAuth is not configured');
    }
  }
}
