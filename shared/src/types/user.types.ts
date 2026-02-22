export type UserResponse = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  isAdmin: boolean;
  roles: string[];
  isEmailVerified: boolean;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OAuthAccountResponse = {
  provider: string;
  providerId: string;
  createdAt: string;
};
