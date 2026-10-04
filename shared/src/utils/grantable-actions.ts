/**
 * The actions a role may hold on a resource: the admin's narrowing, or every
 * declared action. A narrowing that names an action the code stopped checking
 * keeps nothing of it.
 */
export function grantableActionNames(resource: {
  actionNames: readonly string[];
  allowedActionNames: readonly string[] | null;
}): string[] {
  return (resource.allowedActionNames ?? resource.actionNames).filter((name) =>
    resource.actionNames.includes(name)
  );
}
