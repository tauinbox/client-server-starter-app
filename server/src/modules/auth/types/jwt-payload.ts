import { JwtPayload } from 'jsonwebtoken';
import { UserResponseDto } from '../../users/dtos/user-response.dto';

export type CustomJwtPayload = JwtPayload &
  Pick<UserResponseDto, 'email' | 'isAdmin'>;
export type PayloadFromJwt = {
  userId: UserResponseDto['id'];
} & Pick<UserResponseDto, 'email' | 'isAdmin'>;
