import { ApiProperty } from '@nestjs/swagger';

export class CursorPaginationMeta {
  @ApiProperty({ nullable: true })
  nextCursor: string | null;

  @ApiProperty()
  hasMore: boolean;

  @ApiProperty()
  limit: number;
}

export class CursorPaginatedResponseDto<T> {
  data: T[];
  meta: CursorPaginationMeta;

  constructor(data: T[], nextCursor: string | null, limit: number) {
    this.data = data;
    this.meta = {
      nextCursor,
      hasMore: nextCursor !== null,
      limit
    };
  }
}
