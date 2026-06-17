import { Transform } from 'class-transformer';
import type { ValueTransformer } from 'typeorm';
import { Money } from '@app/shared/utils/money';

/**
 * Maps a Postgres `bigint` money/quantity column to a `Money` value object.
 * node-pg returns `bigint` as a string (a JS `number` cannot hold the full
 * int64 range), so the raw column value never reaches business code: reads
 * yield `Money`, writes accept `Money`. Pair every money/quantity `bigint`
 * column with this so arithmetic always goes through `Money` and never touches
 * a raw string or a float.
 */
export const moneyColumnTransformer: ValueTransformer = {
  to(value?: Money | null): string | null {
    if (value == null) {
      return null;
    }
    return value.toMinorString();
  },
  from(value: string | null): Money | null {
    if (value == null) {
      return null;
    }
    return Money.fromMinor(BigInt(value));
  }
};

/**
 * Serializes a `Money` entity field to the wire `number` contract (minor units,
 * JSON-safe to 2^53; `toNumber` throws loudly above that rather than truncating).
 * Apply alongside `@Column({ transformer: moneyColumnTransformer })` on every
 * money field that appears on the wire.
 */
export const MoneyToNumber = (): PropertyDecorator =>
  Transform(
    ({ value }: { value: unknown }) =>
      value instanceof Money ? value.toNumber() : value,
    { toPlainOnly: true }
  );
