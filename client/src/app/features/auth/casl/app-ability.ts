import type { MongoAbility } from '@casl/ability';

export type Actions =
  | 'manage'
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'list'
  | 'search'
  | 'assign';

export type Subjects = 'User' | 'Role' | 'Permission' | 'Profile' | 'all';

export type AppAbility = MongoAbility<[Actions, Subjects]>;

export const SUBJECT_MAP: Partial<Record<string, Subjects>> = {
  users: 'User',
  roles: 'Role',
  permissions: 'Permission',
  profile: 'Profile'
};
