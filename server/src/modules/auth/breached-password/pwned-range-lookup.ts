import { createHash } from 'crypto';

export const DEFAULT_PWNED_RANGE_URL = 'https://api.pwnedpasswords.com/range';

/**
 * The blocklist answers in well under a second. The cap exists so an
 * unresponsive third party cannot hold a request open: the lookup is abandoned
 * and reported as `unavailable`.
 */
export const DEFAULT_PWNED_TIMEOUT_MS = 2500;

/** `unavailable` is the fail-open branch: the caller decides what to do. */
export type BreachLookupResult = 'clean' | 'breached' | 'unavailable';

export interface PwnedRangeOptions {
  rangeUrl?: string;
  timeoutMs?: number;
  /** Called with the reason a lookup could not answer. */
  onUnavailable?: (reason: string, error?: unknown) => void;
}

/**
 * `Add-Padding` mixes decoy suffixes into the response so the body size cannot
 * be correlated with the prefix. Every decoy carries a count of zero, so a
 * match only counts when the count is above zero.
 */
function suffixIsListed(body: string, suffix: string): boolean {
  for (const line of body.split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    if (line.slice(0, separator).trim().toUpperCase() !== suffix) continue;
    return Number(line.slice(separator + 1).trim()) > 0;
  }
  return false;
}

/**
 * Asks a public range API whether a password is in a breach corpus, which NIST
 * SP 800-63B-4 requires of a verifier.
 *
 * The lookup is k-anonymous: only the first five hex characters of the hash
 * leave the process and the suffix comparison is local, so the third party
 * never sees enough to identify the password.
 *
 * Plain function rather than a Nest provider because `seed-admin.ts` runs
 * outside an application context and must apply the same rule.
 */
export async function lookupBreachedPassword(
  password: string,
  options: PwnedRangeOptions = {}
): Promise<BreachLookupResult> {
  const rangeUrl = options.rangeUrl ?? DEFAULT_PWNED_RANGE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PWNED_TIMEOUT_MS;

  // SHA-1 is the index the range API is keyed by, not a security primitive:
  // the value it protects is never stored and never leaves this process.
  const hash = createHash('sha1').update(password, 'utf8').digest('hex');
  const prefix = hash.slice(0, 5).toUpperCase();
  const suffix = hash.slice(5).toUpperCase();

  try {
    const response = await fetch(`${rangeUrl}/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
      options.onUnavailable?.(`HTTP ${response.status} ${response.statusText}`);
      return 'unavailable';
    }

    const body = await response.text();
    return suffixIsListed(body, suffix) ? 'breached' : 'clean';
  } catch (err) {
    options.onUnavailable?.('request failed', err);
    return 'unavailable';
  }
}
