import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class VkOAuthGuard extends AuthGuard('vkontakte') {}
