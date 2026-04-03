import {
  AbilityBuilder,
  createMongoAbility,
  InferSubjects,
  MongoAbility
} from '@casl/ability';
import type { KnownSubjects } from '@app/shared/generated/casl-subjects';
import type { User } from '../../users/entities/user.entity';
import type { Role } from '../entities/role.entity';
import type { Permission } from '../entities/permission.entity';

/** Known actions: 'create' | 'read' | 'update' | 'delete' | 'search' | 'assign' */
export type Actions = string;

/**
 * Entity classes that support instance-level CASL checks (ability.can(action, entity)).
 * Add new entity classes here when their controller registers a new resource.
 * String literals come from KnownSubjects (auto-generated from @RegisterResource).
 */
type EntitySubjects = InferSubjects<
  typeof User | typeof Role | typeof Permission
>;

export type Subjects = EntitySubjects | KnownSubjects | 'all';

export type AppAbility = MongoAbility<[Actions, Subjects]>;

export type PermissionCheck = [Actions, Subjects];

export { AbilityBuilder, createMongoAbility };
