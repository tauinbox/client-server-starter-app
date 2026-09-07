import type { ValueTransformer } from 'typeorm';

/**
 * Maps a Postgres `bigint` counter to a JS `number`. node-pg returns `bigint`
 * as a string, so without this a read hands business code a string that
 * compares wrong against every number it meets.
 *
 * Only for counters that stay inside `Number.MAX_SAFE_INTEGER`. A money or
 * quantity column takes `moneyColumnTransformer` instead, which keeps the full
 * int64 range.
 */
export const bigintNumberTransformer: ValueTransformer = {
  // `undefined` must survive: TypeORM transforms before it decides whether to
  // emit the column's DEFAULT, so collapsing it to null writes an explicit
  // NULL over that default.
  to(value?: number | null): number | null | undefined {
    return value;
  },
  from(value: string | null): number | null {
    return value === null ? null : Number(value);
  }
};
