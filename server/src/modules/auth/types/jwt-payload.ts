import { JwtPayload } from 'jsonwebtoken';
import { UserResponseDto } from '../../users/dtos/user-response.dto';

export type CustomJwtPayload = JwtPayload & { email: string } & {
  roles?: string[];
  purpose?: string;
  // The session the token belongs to. JwtStrategy refuses a token whose
  // session holds no live refresh row, so a sign-out ends the access token of
  // that device at once.
  sid?: string;
};
export type PayloadFromJwt = {
  userId: UserResponseDto['id'];
  email: string;
  roles: string[];
};
