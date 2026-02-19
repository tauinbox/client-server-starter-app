export type User = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  isAdmin: boolean;
  isEmailVerified: boolean;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type UserSearch = Pick<
  Partial<User>,
  'email' | 'firstName' | 'lastName' | 'isAdmin' | 'isActive'
>;

export type CreateUser = Pick<User, 'email' | 'firstName' | 'lastName'> & {
  password: string;
};

export type UpdateUser = Pick<
  Partial<User>,
  'email' | 'firstName' | 'lastName' | 'isAdmin' | 'isActive'
> & {
  password?: string;
  unlockAccount?: boolean;
};
