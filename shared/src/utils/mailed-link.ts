import type { DataRegion } from '../constants/data-region.constants';

/** The SPA pages that open a mailed token. */
export type MailedLinkPath =
  'verify-email' | 'reset-password' | 'confirm-email-change';

/**
 * The SPA link of a mailed token. The link names the region of the pool that
 * mails it, because one SPA serves every region and the token exists only in
 * that pool.
 */
export function mailedLink(
  clientUrl: string,
  {
    path,
    token,
    region
  }: { path: MailedLinkPath; token: string; region: DataRegion }
): string {
  return `${clientUrl}/${path}?token=${token}&region=${region}`;
}
