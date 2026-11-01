export interface OAuthUserProfile {
  provider: string;
  providerId: string;
  email: string;
  /** Empty when the provider sends no name. */
  name: string;
  // Whether the OAuth provider asserts the email address is verified.
  // Google: profile.emails[i].verified. Facebook and VK: always false, because
  // neither provider asserts that the person owns the mailbox.
  emailVerified: boolean;
}

/** The account of a user at a provider. */
export type ProviderIdentity = Pick<
  OAuthUserProfile,
  'provider' | 'providerId'
>;
