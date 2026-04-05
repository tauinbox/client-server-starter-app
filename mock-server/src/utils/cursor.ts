export interface CursorPayload {
  sortValue: string | number | boolean | null;
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload | null {
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

    return { sortValue: sortValue as CursorPayload['sortValue'], id };
  } catch {
    return null;
  }
}
