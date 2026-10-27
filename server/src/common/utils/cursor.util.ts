import { ErrorKeys } from '@app/shared/constants';
import { ApiError } from '../errors/api-error';
import { parseCursor } from '@app/shared/utils/cursor';
import type { CursorPayload } from '@app/shared/utils/cursor';

export type { CursorPayload };
export { encodeCursor } from '@app/shared/utils/cursor';

export function decodeCursor(cursor: string): CursorPayload {
  const payload = parseCursor(cursor);

  if (!payload) {
    throw new ApiError(ErrorKeys.GENERAL.INVALID_CURSOR, 'Invalid cursor');
  }

  return payload;
}
