/** The width of `refresh_tokens.user_agent`. */
export const MAX_USER_AGENT_LENGTH = 512;

// C0 controls, DEL and the C1 range. None of them is valid in a header value,
// and a stray one would reach the session list verbatim.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * The User-Agent as the session list stores it. The header is written by the
 * client, so it is display data only: no decision reads it, and the list
 * renders it as text. An absent or blank header is stored as null.
 */
export function normalizeUserAgent(
  header: string | string[] | undefined
): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string') return null;

  const clean = raw
    .replace(CONTROL_CHARACTERS, '')
    .trim()
    .slice(0, MAX_USER_AGENT_LENGTH);
  return clean === '' ? null : clean;
}
