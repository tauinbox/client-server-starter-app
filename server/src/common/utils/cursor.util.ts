import { BadRequestException } from '@nestjs/common';

export interface CursorPayload {
  sortValue: string | number | boolean | null;
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('sortValue' in parsed) ||
      !('id' in parsed)
    ) {
      throw new Error('Missing fields');
    }

    const { sortValue, id } = parsed as Record<string, unknown>;

    if (typeof id !== 'string') {
      throw new Error('id must be a string');
    }

    if (
      sortValue !== null &&
      typeof sortValue !== 'string' &&
      typeof sortValue !== 'number' &&
      typeof sortValue !== 'boolean'
    ) {
      throw new Error('sortValue must be a primitive or null');
    }

    return { sortValue, id };
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}
