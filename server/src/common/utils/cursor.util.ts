import { BadRequestException } from '@nestjs/common';
import { parseCursor } from '@app/shared/utils/cursor';
import type { CursorPayload } from '@app/shared/utils/cursor';

export type { CursorPayload };
export { encodeCursor } from '@app/shared/utils/cursor';

export function decodeCursor(cursor: string): CursorPayload {
  const payload = parseCursor(cursor);

  if (!payload) {
    throw new BadRequestException('Invalid cursor');
  }

  return payload;
}
