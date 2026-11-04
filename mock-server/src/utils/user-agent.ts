// Mirrors `normalizeUserAgent` in server/src/common/utils/user-agent.util.ts.
const MAX_USER_AGENT_LENGTH = 512;

const CONTROL_CHARACTERS = /\p{Cc}/gu;

export function normalizeUserAgent(
  header: string | string[] | undefined
): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string') return null;

  const clean = raw
    .replaceAll(CONTROL_CHARACTERS, '')
    .trim()
    .slice(0, MAX_USER_AGENT_LENGTH);
  return clean === '' ? null : clean;
}
