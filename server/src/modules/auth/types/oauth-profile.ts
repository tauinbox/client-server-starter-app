export interface OAuthUserProfile {
  provider: string;
  providerId: string;
  email: string;
  firstName: string;
  lastName: string;
  // Whether the OAuth provider asserts the email address is verified.
  // Google: profile.emails[i].verified. Facebook: profile._json.verified.
  // VK: provider does not expose this — always false.
  emailVerified: boolean;
}
