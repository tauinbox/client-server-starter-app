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
