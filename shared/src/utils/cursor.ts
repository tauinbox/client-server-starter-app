export interface CursorPayload {
  sortValue: string | number | boolean | null;
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Returns `null` for anything that is not a well-formed cursor. Callers that owe
 * the client an error translate that `null` themselves - the server raises
 * `BadRequestException`, the mock restarts the page from the beginning - so this
 * stays free of framework types.
 *
 * Node-only: `Buffer` keeps this module off the client, which treats cursors as
 * opaque strings and must never import it.
 */
export function parseCursor(cursor: string): CursorPayload | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('sortValue' in parsed) ||
      !('id' in parsed)
    ) {
      return null;
    }

    const { sortValue, id } = parsed as Record<string, unknown>;

    if (typeof id !== 'string') return null;

    if (
      sortValue !== null &&
      typeof sortValue !== 'string' &&
      typeof sortValue !== 'number' &&
      typeof sortValue !== 'boolean'
    ) {
      return null;
    }

    return { sortValue, id };
  } catch {
    return null;
  }
}
