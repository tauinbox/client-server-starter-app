import { Money } from '@app/shared/utils/money';

describe('Money', () => {
  describe('fromMinor', () => {
    it('accepts a bigint', () => {
      expect(Money.fromMinor(1234n).toMinorString()).toBe('1234');
    });

    it('accepts an integer number', () => {
      expect(Money.fromMinor(1234).toMinorString()).toBe('1234');
    });

    it('rejects a non-integer number', () => {
      expect(() => Money.fromMinor(12.5)).toThrow(TypeError);
    });
  });

  describe('major <-> minor round-trip', () => {
    it('parses a positive decimal string', () => {
      expect(Money.fromMajorString('12.34').toMinorString()).toBe('1234');
    });

    it('parses a negative decimal string', () => {
      expect(Money.fromMajorString('-0.05').toMinorString()).toBe('-5');
    });

    it('parses an integer string with no fraction', () => {
      expect(Money.fromMajorString('100').toMinorString()).toBe('10000');
    });

    it('round-trips a very large value beyond Number range', () => {
      const major = '99999999999999999999.99';
      const money = Money.fromMajorString(major);
      expect(money.toMinorString()).toBe('9999999999999999999999');
      expect(money.toMajorString()).toBe(major);
    });

    it('formats with zero decimals (no decimal point)', () => {
      expect(Money.fromMinor(500n).toMajorString(0)).toBe('500');
    });

    it('pads the fraction when formatting', () => {
      expect(Money.fromMinor(5n).toMajorString()).toBe('0.05');
    });

    it('throws on more fraction digits than decimals', () => {
      expect(() => Money.fromMajorString('1.234')).toThrow(RangeError);
    });

    it('throws on malformed input', () => {
      expect(() => Money.fromMajorString('12,34')).toThrow(TypeError);
    });
  });

  describe('arithmetic', () => {
    it('adds and subtracts', () => {
      const a = Money.fromMinor(1000n);
      const b = Money.fromMinor(250n);
      expect(a.add(b).toMinorString()).toBe('1250');
      expect(a.sub(b).toMinorString()).toBe('750');
    });

    it('multiplies by an integer without overflow', () => {
      const unitPrice = Money.fromMinor(199n);
      expect(unitPrice.mulInt(10_000_000_000n).toMinorString()).toBe(
        '1990000000000'
      );
    });

    it('rejects a non-integer factor', () => {
      expect(() => Money.fromMinor(100n).mulInt(1.5)).toThrow(TypeError);
    });

    it('floors division toward negative infinity', () => {
      expect(Money.fromMinor(7n).divFloor(2).toMinorString()).toBe('3');
      expect(Money.fromMinor(-7n).divFloor(2).toMinorString()).toBe('-4');
    });

    it('throws on division by zero', () => {
      expect(() => Money.fromMinor(7n).divFloor(0)).toThrow(RangeError);
    });
  });

  describe('compare / equals', () => {
    it('compares', () => {
      expect(Money.fromMinor(1n).compare(Money.fromMinor(2n))).toBe(-1);
      expect(Money.fromMinor(2n).compare(Money.fromMinor(2n))).toBe(0);
      expect(Money.fromMinor(3n).compare(Money.fromMinor(2n))).toBe(1);
    });

    it('checks equality', () => {
      expect(Money.fromMinor(5n).equals(Money.fromMinor(5n))).toBe(true);
      expect(Money.fromMinor(5n).equals(Money.fromMinor(6n))).toBe(false);
    });
  });

  describe('toNumber overflow guard', () => {
    it('returns a number within safe-integer range', () => {
      expect(Money.fromMinor(123456n).toNumber()).toBe(123456);
    });

    it('throws above Number.MAX_SAFE_INTEGER', () => {
      const tooBig = Money.fromMinor(BigInt(Number.MAX_SAFE_INTEGER) + 1n);
      expect(() => tooBig.toNumber()).toThrow(RangeError);
    });

    it('throws below -Number.MAX_SAFE_INTEGER', () => {
      const tooSmall = Money.fromMinor(-BigInt(Number.MAX_SAFE_INTEGER) - 1n);
      expect(() => tooSmall.toNumber()).toThrow(RangeError);
    });
  });
});
