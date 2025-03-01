export type User = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  isAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type UserSearch = {
  email?: string;
  firstName?: string;
  lastName?: string;
  isAdmin?: boolean;
  isActive?: boolean;
}

export type CreateUser = {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
}

export type UpdateUser = {
  email?: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  isAdmin?: boolean;
  isActive?: boolean;
}
