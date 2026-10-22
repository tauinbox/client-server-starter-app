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

/**
 * Whether a write of `allowedActionNames` changes the grantable actions, and
 * so the abilities of each holder of a role with a grant on the resource.
 */
export function changesGrantableActions(
  resource: {
    actionNames: readonly string[];
    allowedActionNames: readonly string[] | null;
  },
  allowedActionNames: readonly string[] | null
): boolean {
  const before = grantableActionNames(resource);
  const after = grantableActionNames({
    actionNames: resource.actionNames,
    allowedActionNames
  });
  return (
    after.some((name) => !before.includes(name)) ||
    before.some((name) => !after.includes(name))
  );
}

/**
 * The actions that a write of `allowedActionNames` offers again: grantable
 * after the write and not before it.
 */
export function reofferedActionNames(
  resource: {
    actionNames: readonly string[];
    allowedActionNames: readonly string[] | null;
  },
  allowedActionNames: readonly string[] | null
): string[] {
  const before = grantableActionNames(resource);
  return grantableActionNames({
    actionNames: resource.actionNames,
    allowedActionNames
  }).filter((name) => !before.includes(name));
}
