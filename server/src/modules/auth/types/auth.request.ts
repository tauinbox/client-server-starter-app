import { Request } from 'express';
import { UserResponseDto } from '../../users/dtos/user-response.dto';
import { PayloadFromJwt } from './jwt-payload';
import type { AppAbility } from '../casl/app-ability';

export type LocalAuthRequest = Request & {
  user: UserResponseDto;
};
export type JwtAuthRequest = Request & {
  user: PayloadFromJwt;
  /** Populated by PermissionsGuard — available in controllers via @CurrentAbility() */
  ability?: AppAbility;
};
