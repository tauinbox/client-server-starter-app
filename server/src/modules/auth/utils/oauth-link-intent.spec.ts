import {
  bindLinkIntent,
  isLinkIntentBound,
  readLinkIntentForFlow
} from './oauth-link-intent';

// A JWT holds the two characters the format must survive: the dot that
// separates its parts, and the base64url alphabet that includes `-` and `_`.
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LTEifQ.a-b_c';
const STATE = 'a'.repeat(64);
const OTHER_STATE = 'b'.repeat(64);

describe('oauth link intent', () => {
  describe('isLinkIntentBound', () => {
    it('should report a fresh intent as unclaimed', () => {
      expect(isLinkIntentBound(TOKEN)).toBe(false);
    });

    it('should report a claimed intent as bound', () => {
      expect(isLinkIntentBound(bindLinkIntent(TOKEN, STATE))).toBe(true);
    });
  });

  describe('readLinkIntentForFlow', () => {
    it('should return the token to the flow that claimed the intent', () => {
      const intent = bindLinkIntent(TOKEN, STATE);

      expect(readLinkIntentForFlow(intent, STATE)).toBe(TOKEN);
    });

    it('should return nothing to a flow that presents another state', () => {
      const intent = bindLinkIntent(TOKEN, STATE);

      expect(readLinkIntentForFlow(intent, OTHER_STATE)).toBeNull();
    });

    it('should return nothing for an intent that no flow claimed', () => {
      expect(readLinkIntentForFlow(TOKEN, STATE)).toBeNull();
    });

    it('should return nothing when the callback carries no state', () => {
      const intent = bindLinkIntent(TOKEN, STATE);

      expect(readLinkIntentForFlow(intent, undefined)).toBeNull();
      // Express gives an array when the parameter repeats.
      expect(readLinkIntentForFlow(intent, [STATE])).toBeNull();
    });

    it('should return nothing when the bound value carries no token', () => {
      expect(readLinkIntentForFlow(`b:${STATE}:`, STATE)).toBeNull();
      expect(readLinkIntentForFlow(`b:${STATE}`, STATE)).toBeNull();
      expect(readLinkIntentForFlow(`b::${TOKEN}`, '')).toBeNull();
    });

    it('should keep a token that contains the separator whole', () => {
      const tokenWithSeparator = `${TOKEN}:tail`;
      const intent = bindLinkIntent(tokenWithSeparator, STATE);

      expect(readLinkIntentForFlow(intent, STATE)).toBe(tokenWithSeparator);
    });
  });
});
