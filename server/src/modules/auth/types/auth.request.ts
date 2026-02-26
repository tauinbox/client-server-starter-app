import { Request } from 'express';
import { UserResponseDto } from '../../users/dtos/user-response.dto';
import { PayloadFromJwt } from './jwt-payload';

export type LocalAuthRequest = Request & {
  user: UserResponseDto;
};
export type JwtAuthRequest = Request & {
  user: PayloadFromJwt;
};
