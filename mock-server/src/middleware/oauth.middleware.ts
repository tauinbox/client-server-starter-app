import { randomUUID } from 'crypto';
import { Router, type Response } from 'express';
import { signedTokenAccount } from '@app/shared/utils/token-revocation';
import { completeSignIn } from '../helpers/sign-in.helpers';
import {
  ErrorKeys,
  isCountryCode,
  OAUTH_ERROR,
  STEP_UP_OPERATION,
  STEP_UP_OPERATIONS,
  VERIFICATION_TOKEN_EXPIRY_MS,
  type CountryCode
} from '@app/shared/constants';
import { oneOfErrors, unknownPropertyErrors } from '../utils/validation';
import {
  addOAuthAccounts,
  findUserByEmail,
  findUserById,
  findUserByPendingEmail,
  getState,
  logAudit
} from '../state';
import { residenceRefusal } from '../helpers/region.helpers';
import {
  buildMockUser,
  RESIDENCE_COUNTRY_ERROR
} from '../helpers/user-create.helpers';
import { pushUserCrudEvent } from '../helpers/user-list-events.helpers';
import { authGuard } from '../helpers/auth.helpers';
import {
  clearReauthProofCookie,
  sendWithRetryAfter,
  stepUpError
} from '../helpers/reauth.helpers';
import {
  requireStepUpBody,
  sendValidationError
} from '../helpers/validation-error.helpers';
import { sendError } from '../helpers/error-envelope.helpers';
import {
  AUTH_COOKIE_PATH,
  OAUTH_DATA_COOKIE,
  OAUTH_PROVIDERS,
  OAUTH_SIGNUP_COOKIE
} from '../constants';
import type { AuthenticatedRequest } from '../types';

const router = Router();

// GET /api/v1/auth/oauth/accounts
router.get('/accounts', authGuard, (req, res) => {
  const { user } = req as AuthenticatedRequest;
  const accounts = getState().oauthAccounts.get(user.id) || [];

  res.json(
    accounts.map((a) => ({
      provider: a.provider,
      createdAt: a.createdAt
    }))
  );
});

// DELETE /api/v1/auth/oauth/accounts/:provider
// Removing a provider is a credential change in the same way that adding one
// is, so the route demands the same fresh proof of identity the link route
// demands. The provider name is checked before the step-up, so a typo costs no
// step-up.
router.delete(
  '/accounts/:provider',
  authGuard,
  requireStepUpBody(),
  (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const provider = req.params['provider'] as string;

    if (!OAUTH_PROVIDERS.includes(provider)) {
      sendError(
        res,
        ErrorKeys.AUTH.INVALID_OAUTH_PROVIDER,
        `Invalid OAuth provider: ${provider}`
      );

      return;
    }

    const { currentPassword, code } = (req.body ?? {}) as Record<
      string,
      unknown
    >;

    const stepUp = stepUpError(req, user, {
      currentPassword,
      code,
      operation: STEP_UP_OPERATION.OAUTH_UNLINK
    });

    if (stepUp) {
      sendWithRetryAfter(res, stepUp);

      return;
    }

    const state = getState();
    const accounts = state.oauthAccounts.get(user.id) || [];

    if (!accounts.some((a) => a.provider === provider)) {
      sendError(
        res,
        ErrorKeys.AUTH.OAUTH_PROVIDER_NOT_LINKED,
        `No linked ${provider} account found`
      );

      return;
    }

    const otherOAuth = accounts.filter((a) => a.provider !== provider).length;

    if (!user.password && otherOAuth === 0) {
      sendError(
        res,
        ErrorKeys.AUTH.UNLINK_LAST_PROVIDER,
        'This is the only way you can sign in. Link another provider first, or set a password through the forgot-password link.'
      );

      return;
    }

    state.oauthAccounts.set(
      user.id,
      accounts.filter((a) => a.provider !== provider)
    );

    clearReauthProofCookie(res);

    logAudit('OAUTH_UNLINK', {
      actorId: user.id,
      actorEmail: user.email,
      targetId: user.id,
      targetType: 'User',
      details: { provider },
      ip: req.ip
    });

    console.log(
      `[PROVIDER UNLINKED] To: ${user.email}\n  Provider: ${provider} | IP: ${req.ip}`
    );

    res.json({ message: `${provider} account unlinked successfully` });
  }
);

// The provider round trip needs a real identity provider, so both halves stay
// stubs. What the round trip *produces* - the `oauth_data` cookie - is minted
// by POST /__control/oauth-data instead, which is how E2E drives the exchange.
for (const provider of OAUTH_PROVIDERS) {
  router.get(`/${provider}`, (_req, res) => {
    // eslint-disable-next-line no-restricted-syntax -- a stub of the mock only; the server redirects here
    res.status(501).json({
      message: `OAuth ${provider} redirect requires a real backend. Use the mock-server for API-level testing only.`,
      statusCode: 501
    });
  });

  router.get(`/${provider}/callback`, (_req, res) => {
    // eslint-disable-next-line no-restricted-syntax -- a stub of the mock only; the server redirects here
    res.status(501).json({
      message: `OAuth ${provider} callback requires a real backend.`,
      statusCode: 501
    });
  });
}

function sendInvalidOAuthData(res: Response): void {
  sendError(
    res,
    ErrorKeys.AUTH.INVALID_OAUTH_DATA,
    'Invalid or expired OAuth data'
  );
}

// POST /api/v1/auth/oauth/exchange
router.post('/exchange', (req, res) => {
  const cookie = (req.cookies as Record<string, string> | undefined)?.[
    OAUTH_DATA_COOKIE
  ];

  res.clearCookie(OAUTH_DATA_COOKIE, { path: AUTH_COOKIE_PATH });

  if (!cookie) {
    sendError(res, ErrorKeys.AUTH.MISSING_OAUTH_DATA, 'Missing OAuth data');

    return;
  }

  const state = getState();
  const pending = state.oauthDataTokens.get(cookie);

  // One-shot, like the cookie the real server clears on exchange.
  state.oauthDataTokens.delete(cookie);

  if (!pending || pending.expiresAt < Date.now()) {
    sendInvalidOAuthData(res);

    return;
  }

  // No session exists behind a challenge, so nothing is handed out but the
  // right to present a code. POST /auth/mfa/verify finishes the sign-in and
  // checks the account, as on the server. The server route sets no other
  // status, so a POST answers 201.
  if ('challenge' in pending) {
    res.status(201).json(pending.challenge);

    return;
  }

  // No account exists yet: POST /auth/oauth/signup creates it once the user
  // declares the country of residence, as on the server.
  if ('residenceRequired' in pending) {
    res.status(201).json({ residenceRequired: true });

    return;
  }

  // A deactivated or recovered account gets the refusal a bad cookie gets, as
  // on the server, so the exchange tells nothing about the account. The
  // pending entry names the account, so the audit row names it too.
  const verdict = signedTokenAccount(
    findUserById(pending.userId),
    pending.issuedAtMs
  );

  if ('refusal' in verdict) {
    logAudit('USER_LOGIN_FAILURE', {
      targetId: pending.userId,
      targetType: 'User',
      details: {
        method: 'oauth',
        provider: pending.provider,
        reason: verdict.refusal
      },
      ip: req.ip
    });
    sendInvalidOAuthData(res);

    return;
  }

  // The session is issued here, as on the server: only this request carries
  // the refresh cookie of the session it replaces.
  res.status(201);
  completeSignIn({ req, res }, verdict.user, {
    method: 'oauth',
    provider: pending.provider
  });
});

// POST /api/v1/auth/oauth/signup
// Creates the account of the provider identity that the `oauth_signup` cookie
// holds, after the region check of the declared country, then signs it in.
router.post('/signup', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { residenceCountry } = body;
  // The global pipe of the server runs before the handler reads the cookie.
  const bodyErrors = [
    ...unknownPropertyErrors(body, ['residenceCountry']),
    ...(isCountryCode(residenceCountry) ? [] : [RESIDENCE_COUNTRY_ERROR])
  ];

  if (bodyErrors.length > 0) {
    sendValidationError(res, 'body', bodyErrors);

    return;
  }

  const country = residenceCountry as CountryCode;
  const cookie = (req.cookies as Record<string, string> | undefined)?.[
    OAUTH_SIGNUP_COOKIE
  ];

  if (!cookie) {
    sendError(res, ErrorKeys.AUTH.MISSING_OAUTH_DATA, 'Missing OAuth data');

    return;
  }

  const state = getState();
  const profile = state.oauthSignupTokens.get(cookie);

  if (!profile || profile.expiresAt < Date.now()) {
    res.clearCookie(OAUTH_SIGNUP_COOKIE, { path: AUTH_COOKIE_PATH });
    sendInvalidOAuthData(res);

    return;
  }

  // Before the cookie is spent, so a refused country can be corrected, as on
  // the server. The refusal writes no audit row, as at registration.
  const refusal = residenceRefusal(country);

  if (refusal) {
    sendError(res, refusal.errorKey, refusal.message);

    return;
  }

  state.oauthSignupTokens.delete(cookie);
  res.clearCookie(OAUTH_SIGNUP_COOKIE, { path: AUTH_COOKIE_PATH });

  const identityTaken = state.oauthAccounts
    .values()
    .some((accounts) =>
      accounts.some(
        (a) =>
          a.provider === profile.provider && a.providerId === profile.providerId
      )
    );

  if (
    identityTaken ||
    findUserByEmail(profile.email) ||
    findUserByPendingEmail(profile.email)
  ) {
    logAudit('USER_LOGIN_FAILURE', {
      details: {
        method: 'oauth',
        provider: profile.provider,
        reason: OAUTH_ERROR.EMAIL_ALREADY_REGISTERED
      },
      ip: req.ip
    });
    sendError(
      res,
      ErrorKeys.USERS.EMAIL_EXISTS,
      'User with this email already exists'
    );

    return;
  }

  // A provider account has no password; the builder takes the fields of the
  // password routes.
  const user = {
    ...buildMockUser(
      {
        email: profile.email,
        name: profile.name || profile.email.split('@')[0],
        password: '',
        locale: 'en'
      },
      { isEmailVerified: profile.emailVerified, residenceCountry: country }
    ),
    password: null
  };

  state.users.set(user.id, user);
  addOAuthAccounts(user.id, [
    {
      provider: profile.provider,
      providerId: profile.providerId,
      createdAt: new Date().toISOString()
    }
  ]);

  if (!profile.emailVerified) {
    const verificationToken = randomUUID();

    state.emailVerificationTokens.set(verificationToken, {
      userId: user.id,
      expiresAt: new Date(
        Date.now() + VERIFICATION_TOKEN_EXPIRY_MS
      ).toISOString()
    });
    console.log(
      `[EMAIL VERIFICATION] To: ${user.email}\n  Verify URL: http://localhost:4200/verify-email?token=${verificationToken}`
    );
  }

  logAudit('USER_REGISTER', {
    actorId: user.id,
    actorEmail: user.email,
    targetId: user.id,
    targetType: 'User',
    details: { provider: profile.provider },
    ip: req.ip
  });
  pushUserCrudEvent('created', user.id);

  res.status(201);
  completeSignIn({ req, res }, user, {
    method: 'oauth',
    provider: profile.provider
  });
});

// POST /api/v1/auth/oauth/link-init The real server mints an intent cookie its
// provider callback consumes. Both provider halves are Not Implemented here, so
// only the step-up the route now demands is reproduced: a linked provider is a
// credential that outlives every session.
router.post('/link-init', authGuard, requireStepUpBody(), (req, res) => {
  const { user } = req as AuthenticatedRequest;
  const { currentPassword, code } = (req.body ?? {}) as Record<string, unknown>;

  const stepUp = stepUpError(req, user, {
    currentPassword,
    code,
    operation: STEP_UP_OPERATION.OAUTH_LINK
  });

  if (stepUp) {
    sendWithRetryAfter(res, stepUp);

    return;
  }

  clearReauthProofCookie(res);

  res.status(201).json({ message: 'Link initiated' });
});

// POST /api/v1/auth/oauth/reauth-init (stub) The real server sets an intent
// cookie that its provider callback consumes. Both provider halves are Not
// Implemented here, so the proof the callback would mint is seeded by POST
// /__control/reauth-proof instead. The body is still validated, because the
// operation it declares is what binds the proof.
router.post('/reauth-init', authGuard, (req, res) => {
  const { operation } = req.body as { operation?: unknown };

  const bodyErrors = [
    ...unknownPropertyErrors(req.body, ['operation']),
    ...oneOfErrors('operation', operation, { values: STEP_UP_OPERATIONS })
  ];

  if (bodyErrors.length > 0) {
    sendValidationError(res, 'body', bodyErrors);

    return;
  }

  res.status(201).json({ message: 'Re-authentication initiated' });
});

export default router;
