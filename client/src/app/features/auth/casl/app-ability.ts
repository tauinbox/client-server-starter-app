import type { MongoAbility } from '@casl/ability';
import type {
  KnownActions,
  KnownSubjects
} from '@app/shared/generated/casl-subjects';

/**
 * CASL action type — string for MongoAbility compatibility (custom actions
 * created via admin UI are stored in DB as arbitrary strings).
 * Use KnownActions in PermissionCheck for compile-time safety at call sites.
 */
export type Actions = string;

/**
 * Valid CASL subject names — auto-generated from @RegisterResource decorators.
 * Re-run `npm run generate:subjects` (from server/) when adding a new resource.
 *
 * Record<string, unknown> is included so that subject()-tagged plain objects
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
  action: KnownActions;
  subject: KnownSubjects | 'all';
  instance?: Record<string, unknown>;
};
