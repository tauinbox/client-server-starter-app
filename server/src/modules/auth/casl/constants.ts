/**
 * CASL reserved keywords that must not be used as action names.
 * - 'manage' grants universal action access when used in can('manage', subject)
 * - 'all' is the wildcard for both actions and subjects in can('manage', 'all')
 */
export const CASL_RESERVED_ACTION_NAMES: readonly string[] = ['manage', 'all'];

/**
 * CASL reserved keywords that must not be used as resource subjects.
 * - 'all' is the wildcard subject in can(action, 'all')
 */
export const CASL_RESERVED_SUBJECT_NAMES: readonly string[] = ['all'];
