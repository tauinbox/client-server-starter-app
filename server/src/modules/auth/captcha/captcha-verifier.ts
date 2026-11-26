import type { CaptchaProvider } from '@app/shared/constants';

/**
 * One captcha vendor. The cell selects one with CAPTCHA_PROVIDER, because
 * each vendor receives the IP address of the caller and may run only in the
 * regions whose entry of REGIONS lists it.
 */
export interface CaptchaVerifier {
  readonly provider: CaptchaProvider;
  /** The public key that the client widget renders with. */
  readonly siteKey: string;
  /** Fails closed: a vendor error or a timeout gives false. */
  verify(token: string, remoteIp?: string): Promise<boolean>;
}
