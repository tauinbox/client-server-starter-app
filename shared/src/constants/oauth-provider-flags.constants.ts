/**
 * Single source of truth wiring each OAuth provider to:
 *  - the server env var that proves it is configured (`*_CLIENT_ID`),
 *  - the feature-flag attribute key the auth module registers from that env var,
 *  - the public feature-flag key the login UI gates the provider button on.
 *
 * Effective visibility of a provider button is:
 *   envConfigured(envVar) AND flagEnabled(flagKey)
 * implemented as a public flag (`flagKey`, the manual override) carrying an
 * `attribute / custom / eq true` rule against `attributeKey` (the env signal).
 *
 * Consumed by: the server attribute registrar + seeder, the mock-server flag
 * evaluator + seed, and the client login component. The DB migration mirrors
 * these literals but does not import them (migrations are historical records).
 */
export const OAUTH_PROVIDER_FLAGS = [
  {
    provider: 'google',
    envVar: 'GOOGLE_CLIENT_ID',
    attributeKey: 'oauthGoogleConfigured',
    flagKey: 'oauth-google'
  },
  {
    provider: 'facebook',
    envVar: 'FACEBOOK_CLIENT_ID',
    attributeKey: 'oauthFacebookConfigured',
    flagKey: 'oauth-facebook'
  },
  {
    provider: 'vk',
    envVar: 'VK_CLIENT_ID',
    attributeKey: 'oauthVkConfigured',
    flagKey: 'oauth-vk'
  }
] as const;

export type OAuthProviderFlag = (typeof OAUTH_PROVIDER_FLAGS)[number];
