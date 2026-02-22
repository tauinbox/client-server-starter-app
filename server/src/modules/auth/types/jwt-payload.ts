import { JwtPayload } from 'jsonwebtoken';
import { UserResponseDto } from '../../users/dtos/user-response.dto';

export type CustomJwtPayload = JwtPayload & { email: string } & {
  roles?: string[];
};
export type PayloadFromJwt = {
  userId: UserResponseDto['id'];
  email: string;
  roles: string[];
};
