export type ResourceResponse = {
  id: string;
  name: string;
  subject: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
  isOrphaned: boolean;
  isRegistered: boolean;
  /** Actions the code checks on this subject. Owned by the code. */
  actionNames: string[];
  /** Actions whose checks evaluate a grant condition on the record. */
  conditionalActionNames: string[];
  /** Admin narrowing of `actionNames`; null offers every declared action. */
  allowedActionNames: string[] | null;
  createdAt: string;
};

export type ActionResponse = {
  id: string;
  name: string;
  createdAt: string;
};

export type RbacMetadataResponse = {
  resources: ResourceResponse[];
};

/**
 * Resource name -> CASL subject, split by orphan state.
 *
 * Only `active` may grant: an orphaned resource has lost the controller that
 * registered it, so nothing may be allowed on it. Denies resolve against
 * `orphaned` as a fallback so that removing a controller cannot quietly drop a
 * deny rule (see `compileAbilityRules`).
 */
export interface SubjectMaps {
  active: Record<string, string>;
  orphaned: Record<string, string>;
  /**
   * Resource name -> actions a role may hold on it: the admin's narrowing, or
   * every declared action. `compileAbilityRules` registers no allow outside
   * this set, so a grant hidden from the permission matrix grants nothing.
   */
  grantableActions: Record<string, string[]>;
  /** Resource name -> actions whose checks read the record. */
  conditionalActions: Record<string, string[]>;
}
