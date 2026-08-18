import { encodeCursor, parseCursor } from '@app/shared/utils/cursor';

const encodeRaw = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

describe('shared cursor codec', () => {
  describe('round-trip', () => {
    it('should encode and decode a string sortValue', () => {
      const payload = { sortValue: 'test@example.com', id: 'abc-123' };
      expect(parseCursor(encodeCursor(payload))).toEqual(payload);
    });

    it('should encode and decode a numeric sortValue', () => {
      const payload = { sortValue: 42, id: 'id-1' };
      expect(parseCursor(encodeCursor(payload))).toEqual(payload);
    });

    it('should encode and decode a boolean sortValue', () => {
      const payload = { sortValue: false, id: 'id-2' };
      expect(parseCursor(encodeCursor(payload))).toEqual(payload);
    });

    it('should encode and decode a null sortValue', () => {
      const payload = { sortValue: null, id: 'id-3' };
      expect(parseCursor(encodeCursor(payload))).toEqual(payload);
    });

    it('should preserve special characters in sort values', () => {
      const payload = { sortValue: 'user+test@exam.com', id: 'uuid-4' };
      expect(parseCursor(encodeCursor(payload))).toEqual(payload);
    });

    it('should emit a url-safe token with no base64 padding', () => {
      const cursor = encodeCursor({ sortValue: 'a?b/c+d', id: 'id-5' });
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe('parseCursor — malformed input', () => {
    it('should return null for a non-base64 token', () => {
      expect(parseCursor('not-valid!!!')).toBeNull();
    });

    it('should return null for valid base64 that is not JSON', () => {
      expect(
        parseCursor(Buffer.from('not json').toString('base64url'))
      ).toBeNull();
    });

    it('should return null for JSON that is not an object', () => {
      expect(parseCursor(encodeRaw('a string'))).toBeNull();
      expect(parseCursor(encodeRaw(null))).toBeNull();
    });

    it('should return null when id is missing', () => {
      expect(parseCursor(encodeRaw({ sortValue: 'x' }))).toBeNull();
    });

    it('should return null when sortValue is missing', () => {
      expect(parseCursor(encodeRaw({ id: '1' }))).toBeNull();
    });

    it('should return null when id is not a string', () => {
      expect(parseCursor(encodeRaw({ sortValue: 'x', id: 123 }))).toBeNull();
    });

    it('should return null when sortValue is not a primitive', () => {
      expect(
        parseCursor(encodeRaw({ sortValue: { nested: true }, id: '1' }))
      ).toBeNull();
      expect(parseCursor(encodeRaw({ sortValue: ['x'], id: '1' }))).toBeNull();
    });
  });
});
