import { Request } from 'express';
import { User } from '../../users/entities/user.entity';
import { PayloadFromJwt } from './jwt-payload';
import type { AppAbility } from '../casl/app-ability';

export type LocalAuthRequest = Request & {
  user: User;
};
export type JwtAuthRequest = Request & {
  user: PayloadFromJwt;
  /** Populated by PermissionsGuard — available in controllers via @CurrentAbility() */
  ability?: AppAbility;
};
