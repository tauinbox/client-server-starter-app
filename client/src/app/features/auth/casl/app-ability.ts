import type { MongoAbility } from '@casl/ability';

/** Known actions: 'create' | 'read' | 'update' | 'delete' | 'search' | 'assign' */
export type Actions = string;

/** Known subjects: 'User' | 'Role' | 'Permission' | 'Profile' | 'all' */
export type Subjects = string;

export type AppAbility = MongoAbility<[Actions, Subjects]>;

export type PermissionCheck = { action: Actions; subject: Subjects };
