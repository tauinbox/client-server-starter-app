import {
  AbilityBuilder,
  createMongoAbility,
  InferSubjects,
  MongoAbility
} from '@casl/ability';
import type {
  KnownActions,
  KnownSubjects
} from '@app/shared/generated/casl-subjects';
import type { User } from '../../users/entities/user.entity';
import type { Role } from '../entities/role.entity';
import type { Permission } from '../entities/permission.entity';

/**
 * CASL action type — string for MongoAbility compatibility (custom actions
 * created via admin UI are stored in DB as arbitrary strings).
 * Use KnownActions in PermissionCheck for compile-time safety on @Authorize calls.
 */
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

/**
 * Typed permission check used by @Authorize decorator and PermissionsGuard.
 * KnownActions catches typos at compile time; Subjects validates resource names.
 */
export type PermissionCheck = [KnownActions, Subjects];

export { AbilityBuilder, createMongoAbility };
export type { KnownActions };
