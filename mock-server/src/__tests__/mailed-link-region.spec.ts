import { DATA_REGIONS } from '@app/shared/constants';
import { mailedTokenLink } from '../helpers/mailed-link.helpers';
import { createMockInstance, runInInstance } from '../instance';

// Mirrors MailService of the server: a mailed link names the region of the
// instance that mails it.
describe('mailed token link', () => {
  it.each(DATA_REGIONS)('names the region %s of its instance', (region) => {
    const link = runInInstance(createMockInstance(region), () =>
      mailedTokenLink('reset-password', 'tok')
    );

    expect(link).toBe(
      `http://localhost:4200/reset-password?token=tok&region=${region}`
    );
  });
});
