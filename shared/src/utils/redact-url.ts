/**
 * Query parameters whose value is a credential. The OAuth callback carries the
 * authorization code and the state in its query string, and a request log line
 * must store neither. The comparison ignores case.
 */
export const SENSITIVE_QUERY_PARAMS: readonly string[] = [
  'code',
  'state',
  'token'
];

const REDACTED = 'REDACTED';

/**
 * Returns the URL with the value of each sensitive query parameter replaced.
 * A URL that carries none of them comes back unchanged, so an ordinary log line
 * keeps its original encoding.
 */
export function redactSensitiveQuery(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;

  const params = new URLSearchParams(url.slice(queryStart + 1));
  let changed = false;
  for (const key of new Set(params.keys())) {
    if (SENSITIVE_QUERY_PARAMS.includes(key.toLowerCase())) {
      params.set(key, REDACTED);
      changed = true;
    }
  }

  return changed ? `${url.slice(0, queryStart)}?${params.toString()}` : url;
}
