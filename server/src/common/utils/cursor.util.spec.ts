import { BadRequestException } from '@nestjs/common';
import { encodeCursor, decodeCursor } from './cursor.util';

describe('cursor.util', () => {
  describe('round-trip', () => {
    it('should encode and decode a string sortValue', () => {
      const payload = { sortValue: 'test@example.com', id: 'abc-123' };
      const cursor = encodeCursor(payload);
      expect(decodeCursor(cursor)).toEqual(payload);
    });

    it('should encode and decode a numeric sortValue', () => {
      const payload = { sortValue: 42, id: 'id-1' };
      expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
    });

    it('should encode and decode a boolean sortValue', () => {
      const payload = { sortValue: true, id: 'id-2' };
      expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
    });

    it('should encode and decode a null sortValue', () => {
      const payload = { sortValue: null, id: 'id-3' };
      expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
    });

    it('should handle special characters in sort values', () => {
      const payload = { sortValue: 'user+test@exam.com', id: 'uuid-4' };
      expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
    });
  });

  describe('decodeCursor — invalid input', () => {
    it('should throw BadRequestException for invalid base64', () => {
      expect(() => decodeCursor('not-valid!!!')).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for valid base64 but invalid JSON', () => {
      const encoded = Buffer.from('not json').toString('base64url');
      expect(() => decodeCursor(encoded)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for JSON missing id', () => {
      const encoded = Buffer.from(JSON.stringify({ sortValue: 'x' })).toString(
        'base64url'
      );
      expect(() => decodeCursor(encoded)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for JSON missing sortValue', () => {
      const encoded = Buffer.from(JSON.stringify({ id: '1' })).toString(
        'base64url'
      );
      expect(() => decodeCursor(encoded)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException when id is not a string', () => {
      const encoded = Buffer.from(
        JSON.stringify({ sortValue: 'x', id: 123 })
      ).toString('base64url');
      expect(() => decodeCursor(encoded)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException when sortValue is an object', () => {
      const encoded = Buffer.from(
        JSON.stringify({ sortValue: { nested: true }, id: '1' })
      ).toString('base64url');
      expect(() => decodeCursor(encoded)).toThrow(BadRequestException);
    });
  });
});
