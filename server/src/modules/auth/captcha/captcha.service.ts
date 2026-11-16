import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CaptchaProvider } from '@app/shared/constants';
import type { CaptchaConfigResponse } from '@app/shared/types';
import type { CaptchaVerifier } from './captcha-verifier';
import { TurnstileVerifier } from './turnstile.verifier';

// The config validation guarantees the keys of the selected provider.
function createVerifier(
  provider: CaptchaProvider,
  config: ConfigService
): CaptchaVerifier {
  switch (provider) {
    case 'turnstile':
      return new TurnstileVerifier({
        siteKey: config.getOrThrow<string>('TURNSTILE_SITE_KEY'),
        secretKey: config.getOrThrow<string>('TURNSTILE_SECRET_KEY')
      });
  }
}

@Injectable()
export class CaptchaService {
  private readonly verifier: CaptchaVerifier | null;

  constructor(configService: ConfigService) {
    // An empty value means no captcha, as the config validation reads it.
    const provider = configService.get<CaptchaProvider | ''>(
      'CAPTCHA_PROVIDER'
    );

    this.verifier = provider ? createVerifier(provider, configService) : null;
  }

  isEnabled(): boolean {
    return this.verifier !== null;
  }

  getConfig(): CaptchaConfigResponse {
    return this.verifier
      ? {
          enabled: true,
          provider: this.verifier.provider,
          siteKey: this.verifier.siteKey
        }
      : { enabled: false, provider: null, siteKey: null };
  }

  async verify(token: string, remoteIp?: string): Promise<boolean> {
    // The only pass-through: this cell selects no captcha provider.
    if (!this.verifier) return true;

    if (!token) return false;

    return this.verifier.verify(token, remoteIp);
  }
}
