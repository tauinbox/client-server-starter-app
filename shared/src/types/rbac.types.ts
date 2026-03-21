export type ResourceResponse = {
  id: string;
  name: string;
  subject: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
  isOrphaned: boolean;
  allowedActionNames: string[] | null;
  createdAt: string;
};

export type ActionResponse = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  createdAt: string;
};

export type RbacMetadataResponse = {
  resources: ResourceResponse[];
  actions: ActionResponse[];
};
