import { ErrorKeys } from '@app/shared/constants';
import { thrownBy } from '../testing/thrown-by';
import { expectApiError } from '../testing/api-error.expect';
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
    const expectInvalidCursor = (cursor: string) =>
      expectApiError(
        thrownBy(() => decodeCursor(cursor)),
        ErrorKeys.GENERAL.INVALID_CURSOR
      );

    it('refuses invalid base64', () => {
      expectInvalidCursor('not-valid!!!');
    });

    it('carries an errorKey, so the client can translate the refusal', () => {
      expect(thrownBy(() => decodeCursor('not-valid!!!'))).toMatchObject({
        response: {
          message: 'Invalid cursor',
          errorKey: ErrorKeys.GENERAL.INVALID_CURSOR
        }
      });
    });

    it('refuses valid base64 but invalid JSON', () => {
      expectInvalidCursor(Buffer.from('not json').toString('base64url'));
    });

    it('refuses JSON missing id', () => {
      expectInvalidCursor(
        Buffer.from(JSON.stringify({ sortValue: 'x' })).toString('base64url')
      );
    });

    it('refuses JSON missing sortValue', () => {
      expectInvalidCursor(
        Buffer.from(JSON.stringify({ id: '1' })).toString('base64url')
      );
    });

    it('refuses an id that is not a string', () => {
      expectInvalidCursor(
        Buffer.from(JSON.stringify({ sortValue: 'x', id: 123 })).toString(
          'base64url'
        )
      );
    });

    it('refuses a sortValue that is an object', () => {
      expectInvalidCursor(
        Buffer.from(
          JSON.stringify({ sortValue: { nested: true }, id: '1' })
        ).toString('base64url')
      );
    });
  });
});
