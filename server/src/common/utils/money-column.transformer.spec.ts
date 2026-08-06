import { Money } from '@app/shared/utils/money';
import { moneyColumnTransformer } from './money-column.transformer';

describe('moneyColumnTransformer', () => {
  it('encodes a Money value as a minor-unit string', () => {
    expect(moneyColumnTransformer.to(Money.fromMinor(12345))).toBe('12345');
  });

  it('decodes a bigint column string back to Money', () => {
    expect(moneyColumnTransformer.from('12345')).toEqual(
      Money.fromMinor(12345)
    );
    expect(moneyColumnTransformer.from(null)).toBeNull();
  });

  it('keeps null and undefined apart', () => {
    // TypeORM transforms an insert value before it decides whether to emit the
    // column's DEFAULT, and only `undefined` reaches that branch. Collapsing it
    // to null writes an explicit NULL over a NOT NULL DEFAULT 0 column.
    expect(moneyColumnTransformer.to(null)).toBeNull();
    expect(moneyColumnTransformer.to(undefined)).toBeUndefined();
  });
});
