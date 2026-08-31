import {
  bindIntent,
  isIntentBound,
  readIntentForFlow
} from './oauth-flow-intent';

// A JWT holds the two characters the format must survive: the dot that
// separates its parts, and the base64url alphabet that includes `-` and `_`.
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LTEifQ.a-b_c';
const STATE = 'a'.repeat(64);
const OTHER_STATE = 'b'.repeat(64);

describe('oauth link intent', () => {
  describe('isIntentBound', () => {
    it('should report a fresh intent as unclaimed', () => {
      expect(isIntentBound(TOKEN)).toBe(false);
    });

    it('should report a claimed intent as bound', () => {
      expect(isIntentBound(bindIntent(TOKEN, STATE))).toBe(true);
    });
  });

  describe('readIntentForFlow', () => {
    it('should return the token to the flow that claimed the intent', () => {
      const intent = bindIntent(TOKEN, STATE);

      expect(readIntentForFlow(intent, STATE)).toBe(TOKEN);
    });

    it('should return nothing to a flow that presents another state', () => {
      const intent = bindIntent(TOKEN, STATE);

      expect(readIntentForFlow(intent, OTHER_STATE)).toBeNull();
    });

    it('should return nothing for an intent that no flow claimed', () => {
      expect(readIntentForFlow(TOKEN, STATE)).toBeNull();
    });

    it('should return nothing when the callback carries no state', () => {
      const intent = bindIntent(TOKEN, STATE);

      expect(readIntentForFlow(intent, undefined)).toBeNull();
      // Express gives an array when the parameter repeats.
      expect(readIntentForFlow(intent, [STATE])).toBeNull();
    });

    it('should return nothing when the bound value carries no token', () => {
      expect(readIntentForFlow(`b:${STATE}:`, STATE)).toBeNull();
      expect(readIntentForFlow(`b:${STATE}`, STATE)).toBeNull();
      expect(readIntentForFlow(`b::${TOKEN}`, '')).toBeNull();
    });

    it('should keep a token that contains the separator whole', () => {
      const tokenWithSeparator = `${TOKEN}:tail`;
      const intent = bindIntent(tokenWithSeparator, STATE);

      expect(readIntentForFlow(intent, STATE)).toBe(tokenWithSeparator);
    });
  });
});
