import { timingSafeStringEqual } from './timing-safe-equal';

/**
 * A link intent that no authorization flow has claimed carries the link token
 * alone. One that a flow has claimed carries `b:<state>:<token>`.
 *
 * The marker and the separator are both `:`, which appears neither in a hex
 * state nor in a JWT - a JWT is base64url plus `.`, and base64url uses `-` and
 * `_` in place of `+` and `/`. The token therefore never has to be escaped, and
 * the two parts split unambiguously.
 */
const BOUND_MARKER = 'b:';
const FIELD_SEPARATOR = ':';

/** True when an authorization flow already claimed this intent. */
export function isLinkIntentBound(intent: string): boolean {
  return intent.startsWith(BOUND_MARKER);
}

/** Ties an unclaimed intent to the state that one flow just minted. */
export function bindLinkIntent(intent: string, state: string): string {
  return `${BOUND_MARKER}${state}${FIELD_SEPARATOR}${intent}`;
}

/**
 * Returns the link token when the intent belongs to the flow that presents
 * `providedState`, and null in every other case: an unclaimed intent belongs to
 * no flow, and a claimed one belongs to the flow that claimed it.
 */
export function readLinkIntentForFlow(
  intent: string,
  providedState: unknown
): string | null {
  if (!isLinkIntentBound(intent) || typeof providedState !== 'string') {
    return null;
  }

  const rest = intent.slice(BOUND_MARKER.length);
  const separatorIndex = rest.indexOf(FIELD_SEPARATOR);
  if (separatorIndex <= 0) {
    return null;
  }

  const boundState = rest.slice(0, separatorIndex);
  const token = rest.slice(separatorIndex + 1);
  if (token.length === 0 || !timingSafeStringEqual(boundState, providedState)) {
    return null;
  }

  return token;
}
