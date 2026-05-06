import {
  AbilityBuilder,
  createMongoAbility,
  ForcedSubject,
  MongoAbility
} from '@casl/ability';
import type {
  KnownActions,
  KnownSubjects
} from '@app/shared/generated/casl-subjects';

/**
 * CASL action type — string for MongoAbility compatibility (custom actions
 * created via admin UI are stored in DB as arbitrary strings).
 * Use KnownActions in PermissionCheck for compile-time safety on @Authorize calls.
 */
export type Actions = string;

/**
 * Branded plain-object subject for instance-level CASL checks. Wrap entity
 * instances at the call site with CASL's `subject()` helper:
 *
 *   import { subject } from '@casl/ability';
 *   ability.can('update', subject('User', userInstance));
 *
 * Adding a new entity does not require editing this file — `KnownSubjects`
 * is auto-generated from `@RegisterResource` decorators.
 *
 * The mapped type distributes over each subject string so CASL's
 * `Extract<…, TaggedInterface<S>>` resolves to the matching brand. The
 * `Record<PropertyKey, any>` intersection lets MongoQuery accept arbitrary
 * condition fields and keeps TypeORM class instances assignable (CASL's own
 * `setSubjectType` uses the same shape — class instances satisfy it via
 * `any`'s bivariance).
 */
type SubjectInstanceMap = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in KnownSubjects]: ForcedSubject<K> & Record<PropertyKey, any>;
};
export type SubjectInstance = SubjectInstanceMap[KnownSubjects];

export type Subjects = KnownSubjects | SubjectInstance | 'all';

export type AppAbility = MongoAbility<[Actions, Subjects]>;

/**
 * Typed permission check used by @Authorize decorator and PermissionsGuard.
 * KnownActions catches typos at compile time; Subjects validates resource names.
 */
export type PermissionCheck = [KnownActions, Subjects];

export { AbilityBuilder, createMongoAbility };
export type { KnownActions };
