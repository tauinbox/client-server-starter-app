import { MAX_NAME_LENGTH } from '@app/shared/constants';

export interface ProviderNameParts {
  displayName?: string;
  name?: { givenName?: string; familyName?: string };
}

/**
 * The full name a provider asserts: its display name, else the given and
 * family names joined with a space. Empty when the provider sends neither.
 */
export function oauthProfileName(profile: ProviderNameParts): string {
  const displayName = profile.displayName?.trim();
  const name =
    displayName ||
    [profile.name?.givenName, profile.name?.familyName]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(' ');
  return name.slice(0, MAX_NAME_LENGTH);
}
