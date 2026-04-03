import type { MongoAbility } from '@casl/ability';
import type { KnownSubjects } from '@app/shared/generated/casl-subjects';

/** Known actions: 'create' | 'read' | 'update' | 'delete' | 'search' | 'assign' */
export type Actions = string;

/**
 * Valid CASL subject names — auto-generated from @RegisterResource decorators.
 * Re-run `npm run generate:subjects` (from server/) when adding a new resource.
 *
 * Record<PropertyKey, unknown> is included so that subject()-tagged plain objects
 * (instance-level checks) are accepted by ability.can() — standard CASL pattern
 * for plain object subjects that don't have TypeORM entity class constructors.
 */
export type Subjects = KnownSubjects | Record<string, unknown> | 'all';

export type AppAbility = MongoAbility<[Actions, Subjects]>;

/**
 * A single permission check.
 *
 * For type-level checks (route guards, menu visibility):
 *   { action: 'read', subject: 'User' }
 *
 * For instance-level checks (row-level UI, e.g. show Edit button only for own record):
 *   { action: 'update', subject: 'User', instance: { id: '123', ... } }
 *   CASL evaluates conditions (ownership, fieldMatch, etc.) against the instance fields.
 *
 * `subject` is always a string name — the KnownSubjects string literal union.
 * Plain object subjects (ForcedSubject) are an implementation detail of hasPermissions().
 */
export type PermissionCheck = {
  action: Actions;
  subject: KnownSubjects | 'all';
  instance?: Record<string, unknown>;
};
