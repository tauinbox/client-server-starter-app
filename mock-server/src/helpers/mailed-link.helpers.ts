import { mailedLink, type MailedLinkPath } from '@app/shared/utils/mailed-link';
import { mockRegion } from '../instance';

const MOCK_CLIENT_URL = 'http://localhost:4200';

/** The mailed link of the server, with the region of this instance. */
export function mailedTokenLink(path: MailedLinkPath, token: string): string {
  return mailedLink(MOCK_CLIENT_URL, { path, token, region: mockRegion() });
}
