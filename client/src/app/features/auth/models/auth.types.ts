import { CreateUser, User } from '../../users/models/user.types';

export type LoginCredentials = {
  email: string;
  password: string;
}

export type RegisterRequest = CreateUser & {}

export type AuthResponse = {
  access_token: string;
  user: Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'isAdmin'>;
}

export type JwtPayload = {
  userId: User['id'];
  iat: number;
  exp: number;
} & Pick<User, 'email' | 'isAdmin'>;
