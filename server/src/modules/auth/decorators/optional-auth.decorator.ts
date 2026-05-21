import { SetMetadata } from '@nestjs/common';

export const IS_OPTIONAL_AUTH_KEY = 'is_optional_auth';

// Marks a route as accessible to both anonymous and authenticated callers.
// Unlike @Public(), the JWT strategy still runs when a token is present so that
// `req.user` is populated — handlers can then branch on userId for personalised
// responses. Do NOT combine with @Public() on the same handler.
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
