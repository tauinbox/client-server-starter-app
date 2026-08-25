/**
 * A post-login redirect target is only followed when it resolves back to the
 * app's own origin: `/\evil.example` looks internal but browsers read the
 * backslash as a separator and resolve it off-site. The normalised path is
 * returned rather than the input, so the caller navigates to the value that
 * was actually validated. An absent or unparseable origin fails closed.
 */
export function safeReturnUrl(
  url: unknown,
  baseOrigin: string | null | undefined
): string | null {
  if (typeof url !== 'string' || !url || !baseOrigin) return null;

  let parsed: URL;
  try {
    parsed = new URL(url, baseOrigin);
  } catch {
    return null;
  }

  if (parsed.origin !== baseOrigin) return null;

  return parsed.pathname + parsed.search + parsed.hash;
}
