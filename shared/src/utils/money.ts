/**
 * Money value object over BigInt minor units (e.g. cents, kopecks).
 *
 * All arithmetic is exact integer math on minor units - there is no floating
 * point anywhere inside. A `Money` instance is currency-agnostic: it is just a
 * scaled integer. The decimal scale (default 2) is only needed when converting
 * to/from a major-unit decimal string, so it is passed per conversion rather
 * than stored on the instance.
 *
 * Use this for every money computation in billing. Never mix `bigint` with
 * `number` in a raw expression (TypeError) - go through these methods instead.
 */
export class Money {
  private constructor(private readonly minorUnits: bigint) {}

  /** Raw minor-unit value, for persistence (e.g. a bigint column transformer). */
  get minor(): bigint {
    return this.minorUnits;
  }

  static fromMinor(value: bigint | number): Money {
    if (typeof value === 'number') {
      if (!Number.isInteger(value)) {
        throw new TypeError(`Money.fromMinor expects an integer, got ${value}`);
      }
      return new Money(BigInt(value));
    }
    return new Money(value);
  }

  /**
   * Parse a major-unit decimal string such as "12.34" or "-0.05" into minor
   * units. Throws on malformed input or on more fraction digits than `decimals`
   * (silent truncation would lose money).
   */
  static fromMajorString(value: string, decimals = 2): Money {
    if (decimals < 0 || !Number.isInteger(decimals)) {
      throw new RangeError(
        `Money decimals must be a non-negative integer, got ${decimals}`
      );
    }
    const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
    if (!match) {
      throw new TypeError(`Money.fromMajorString cannot parse "${value}"`);
    }
    const [, sign, whole, fraction = ''] = match;
    if (fraction.length > decimals) {
      throw new RangeError(
        `Money.fromMajorString: "${value}" has more than ${decimals} fraction digits`
      );
    }
    const scaled = whole + fraction.padEnd(decimals, '0');
    const magnitude = BigInt(scaled);
    return new Money(sign ? -magnitude : magnitude);
  }

  /** Minor units as a plain integer string (e.g. "1234"). */
  toMinorString(): string {
    return this.minorUnits.toString();
  }

  /** Major-unit decimal string (e.g. "12.34"); no decimal point when decimals is 0. */
  toMajorString(decimals = 2): string {
    if (decimals < 0 || !Number.isInteger(decimals)) {
      throw new RangeError(
        `Money decimals must be a non-negative integer, got ${decimals}`
      );
    }
    const negative = this.minorUnits < 0n;
    const magnitude = negative ? -this.minorUnits : this.minorUnits;
    const sign = negative ? '-' : '';
    if (decimals === 0) {
      return sign + magnitude.toString();
    }
    const divisor = 10n ** BigInt(decimals);
    const whole = magnitude / divisor;
    const fraction = (magnitude % divisor).toString().padStart(decimals, '0');
    return `${sign}${whole.toString()}.${fraction}`;
  }

  add(other: Money): Money {
    return new Money(this.minorUnits + other.minorUnits);
  }

  sub(other: Money): Money {
    return new Money(this.minorUnits - other.minorUnits);
  }

  /** Multiply by an integer factor (e.g. quantity x unit price). */
  mulInt(factor: bigint | number): Money {
    if (typeof factor === 'number' && !Number.isInteger(factor)) {
      throw new TypeError(
        `Money.mulInt expects an integer factor, got ${factor}`
      );
    }
    return new Money(this.minorUnits * BigInt(factor));
  }

  /**
   * Floor division by an integer divisor. Rounds toward negative infinity
   * (BigInt `/` truncates toward zero, which is wrong for negative amounts).
   */
  divFloor(divisor: bigint | number): Money {
    if (typeof divisor === 'number' && !Number.isInteger(divisor)) {
      throw new TypeError(
        `Money.divFloor expects an integer divisor, got ${divisor}`
      );
    }
    const d = BigInt(divisor);
    if (d === 0n) {
      throw new RangeError('Money.divFloor: division by zero');
    }
    const quotient = this.minorUnits / d;
    const remainder = this.minorUnits % d;
    if (remainder !== 0n && remainder < 0n !== d < 0n) {
      return new Money(quotient - 1n);
    }
    return new Money(quotient);
  }

  compare(other: Money): -1 | 0 | 1 {
    if (this.minorUnits < other.minorUnits) return -1;
    if (this.minorUnits > other.minorUnits) return 1;
    return 0;
  }

  equals(other: Money): boolean {
    return this.minorUnits === other.minorUnits;
  }

  /**
   * Minor units as a `number`, for the JSON wire contract (`amountMinor: number`)
   * which is JSON-safe up to 2^53. Throws above `Number.MAX_SAFE_INTEGER` rather
   * than silently truncating.
   */
  toNumber(): number {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    if (this.minorUnits > max || this.minorUnits < -max) {
      throw new RangeError(
        `Money.toNumber: ${this.minorUnits.toString()} exceeds Number.MAX_SAFE_INTEGER`
      );
    }
    return Number(this.minorUnits);
  }
}
