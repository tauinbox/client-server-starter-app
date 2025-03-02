import { CreateUser, User } from '../../users/models/user.types';
import { JwtPayload } from 'jwt-decode';

export type LoginCredentials = {
  email: string;
  password: string;
}

export type RegisterRequest = CreateUser & {}

export type AuthResponse = {
  access_token: string;
  user: User;
}

export type CustomJwtPayload = JwtPayload & {
  userId: User['id'];
} & Pick<User, 'email' | 'isAdmin'>;
