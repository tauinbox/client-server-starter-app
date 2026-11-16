import {
  DEFAULT_SESSION_ABSOLUTE_MAX_MS,
  MIN_JWT_EXPIRATION_SECONDS
} from '@app/shared/constants';
import { MAX_BILLING_PROVIDER_TIMEOUT_MS } from '../billing/providers/provider-deadline';
import { PLAN_CHANGE_LEASE_MS } from '../billing/renewals/renewal-queue.constants';
import { configValidationSchema } from './config-validation.schema';

// Mirrors the validationOptions ConfigModule uses in core.module.ts.
const options = { allowUnknown: true, abortEarly: false };

const validEnv = {
  DATA_REGION: 'intl',
  DB_HOST: 'localhost',
  DB_NAME: 'db',
  DB_USER: 'user',
  DB_PASSWORD: 'pass',
  JWT_SECRET: 'a-jwt-secret-of-thirty-two-chars',
  JWT_EXPIRATION: '3600',
  JWT_REFRESH_EXPIRATION: '604800'
};

describe('configValidationSchema', () => {
  it('accepts a minimal valid env and applies coerced defaults', () => {
    const { error, value } = configValidationSchema.validate(
      validEnv,
      options
    ) as { error?: Error; value: Record<string, unknown> };

    expect(error).toBeUndefined();
    // Defaults are applied as coerced values ConfigService.get() will return.
    expect(value['APPLICATION_PORT']).toBe(3000);
    expect(value['YOOKASSA_VAT_CODE']).toBe(1);
    expect(value['JWT_ALGORITHM']).toBe('HS256');
  });

  it('coerces numeric strings to numbers', () => {
    const { error, value } = configValidationSchema.validate(
      { ...validEnv, APPLICATION_PORT: '8080', YOOKASSA_VAT_CODE: '3' },
      options
    ) as { error?: Error; value: Record<string, unknown> };

    expect(error).toBeUndefined();
    expect(value['APPLICATION_PORT']).toBe(8080);
    expect(value['YOOKASSA_VAT_CODE']).toBe(3);
  });

  it('rejects a non-numeric APPLICATION_PORT instead of letting NaN reach app.listen', () => {
    const { error } = configValidationSchema.validate(
      { ...validEnv, APPLICATION_PORT: 'not-a-port' },
      options
    );

    expect(error?.message).toContain('APPLICATION_PORT');
  });

  it('rejects a missing JWT_REFRESH_EXPIRATION', () => {
    const env: Record<string, string> = { ...validEnv };

    delete env['JWT_REFRESH_EXPIRATION'];

    const { error } = configValidationSchema.validate(env, options);

    expect(error?.message).toContain('JWT_REFRESH_EXPIRATION');
  });

  it('rejects a JWT_EXPIRATION below the client refresh window', () => {
    const { error } = configValidationSchema.validate(
      { ...validEnv, JWT_EXPIRATION: String(MIN_JWT_EXPIRATION_SECONDS - 1) },
      options
    );

    expect(error?.message).toContain('JWT_EXPIRATION');
  });

  it('accepts a JWT_EXPIRATION exactly at the floor', () => {
    const { error } = configValidationSchema.validate(
      { ...validEnv, JWT_EXPIRATION: String(MIN_JWT_EXPIRATION_SECONDS) },
      options
    );

    expect(error).toBeUndefined();
  });

  it('defaults SESSION_ABSOLUTE_MAX_MS to the shared constant', () => {
    const { error, value } = configValidationSchema.validate(
      validEnv,
      options
    ) as { error?: Error; value: Record<string, unknown> };

    expect(error).toBeUndefined();
    expect(value['SESSION_ABSOLUTE_MAX_MS']).toBe(
      DEFAULT_SESSION_ABSOLUTE_MAX_MS
    );
  });

  it('accepts SESSION_ABSOLUTE_MAX_MS=0, which disables the cap', () => {
    const { error, value } = configValidationSchema.validate(
      { ...validEnv, SESSION_ABSOLUTE_MAX_MS: '0' },
      options
    ) as { error?: Error; value: Record<string, unknown> };

    expect(error).toBeUndefined();
    expect(value['SESSION_ABSOLUTE_MAX_MS']).toBe(0);
  });

  it('raises the default SESSION_ABSOLUTE_MAX_MS to a longer refresh window', () => {
    const longWindowSeconds = 90 * 24 * 60 * 60;

    const { error, value } = configValidationSchema.validate(
      { ...validEnv, JWT_REFRESH_EXPIRATION: String(longWindowSeconds) },
      options
    ) as { error?: Error; value: Record<string, unknown> };

    // A refresh token that outlives the constant must not abort the boot on a
    // value nobody set.
    expect(error).toBeUndefined();
    expect(value['SESSION_ABSOLUTE_MAX_MS']).toBe(longWindowSeconds * 1000);
  });

  it('rejects a SESSION_ABSOLUTE_MAX_MS below the refresh window', () => {
    const { error } = configValidationSchema.validate(
      { ...validEnv, SESSION_ABSOLUTE_MAX_MS: String(604800 * 1000 - 1) },
      options
    );

    expect(error?.message).toContain(
      'SESSION_ABSOLUTE_MAX_MS must be 0 or at least JWT_REFRESH_EXPIRATION * 1000'
    );
  });

  it('accepts a SESSION_ABSOLUTE_MAX_MS exactly at the refresh window', () => {
    const { error, value } = configValidationSchema.validate(
      { ...validEnv, SESSION_ABSOLUTE_MAX_MS: String(604800 * 1000) },
      options
    ) as { error?: Error; value: Record<string, unknown> };

    expect(error).toBeUndefined();
    expect(value['SESSION_ABSOLUTE_MAX_MS']).toBe(604800 * 1000);
  });

  it('rejects a missing JWT_SECRET when the algorithm is HS256', () => {
    const env: Record<string, string> = { ...validEnv };

    delete env['JWT_SECRET'];

    const { error } = configValidationSchema.validate(env, options);

    expect(error?.message).toContain('JWT_SECRET');
  });

  it('refuses an HS256 JWT_SECRET below 32 characters', () => {
    const tooShort = 'a-jwt-secret-of-thirty-two-char';

    expect(tooShort).toHaveLength(31);

    const { error } = configValidationSchema.validate(
      { ...validEnv, JWT_SECRET: tooShort },
      options
    );

    expect(error?.message).toContain('JWT_SECRET');

    const atTheFloor = configValidationSchema.validate(
      { ...validEnv, JWT_SECRET: `${tooShort}s` },
      options
    );

    expect(atTheFloor.error).toBeUndefined();
  });

  it('does not apply the HS256 length floor to an unused RS256 JWT_SECRET', () => {
    const { error } = configValidationSchema.validate(
      {
        ...validEnv,
        JWT_ALGORITHM: 'RS256',
        JWT_SECRET: 'short',
        JWT_PRIVATE_KEY: 'private-key',
        JWT_PUBLIC_KEY: 'public-key'
      },
      options
    );

    expect(error).toBeUndefined();
  });

  it('requires key material instead of JWT_SECRET when the algorithm is RS256', () => {
    const env: Record<string, string> = { ...validEnv, JWT_ALGORITHM: 'RS256' };

    delete env['JWT_SECRET'];

    const withoutKeys = configValidationSchema.validate(env, options);

    expect(withoutKeys.error?.message).toContain('JWT_PRIVATE_KEY');

    const withKeys = configValidationSchema.validate(
      { ...env, JWT_PRIVATE_KEY: 'private-key', JWT_PUBLIC_KEY: 'public-key' },
      options
    );

    expect(withKeys.error).toBeUndefined();
  });

  it('rejects a non-numeric or out-of-range YOOKASSA_VAT_CODE', () => {
    for (const vatCode of ['not-a-number', '0', '7']) {
      const { error } = configValidationSchema.validate(
        { ...validEnv, YOOKASSA_VAT_CODE: vatCode },
        options
      );

      expect(error?.message).toContain('YOOKASSA_VAT_CODE');
    }
  });

  it('bounds BILLING_PROVIDER_TIMEOUT_MS by the plan change lease', () => {
    const atMax = configValidationSchema.validate(
      {
        ...validEnv,
        BILLING_PROVIDER_TIMEOUT_MS: String(MAX_BILLING_PROVIDER_TIMEOUT_MS)
      },
      options
    );

    expect(atMax.error).toBeUndefined();

    const aboveMax = configValidationSchema.validate(
      {
        ...validEnv,
        BILLING_PROVIDER_TIMEOUT_MS: String(MAX_BILLING_PROVIDER_TIMEOUT_MS + 1)
      },
      options
    );

    expect(aboveMax.error?.message).toContain('BILLING_PROVIDER_TIMEOUT_MS');
    // Three sequential calls at the maximum still end inside the lease.
    expect(3 * MAX_BILLING_PROVIDER_TIMEOUT_MS).toBeLessThan(
      PLAN_CHANGE_LEASE_MS
    );
  });

  describe('DATA_REGION and PEER_REGIONS', () => {
    function validate(env: Record<string, string>): {
      error?: Error;
      value: Record<string, unknown>;
    } {
      return configValidationSchema.validate(env, options);
    }

    it('refuses a missing or unknown DATA_REGION', () => {
      const { DATA_REGION: _omitted, ...withoutRegion } = validEnv;

      expect(validate(withoutRegion).error?.message).toContain('DATA_REGION');
      expect(
        validate({ ...validEnv, DATA_REGION: 'eu' }).error?.message
      ).toContain('DATA_REGION');
    });

    it('defaults PEER_REGIONS to no peers, also when the value is empty', () => {
      expect(validate(validEnv).value['PEER_REGIONS']).toEqual({});
      expect(
        validate({ ...validEnv, PEER_REGIONS: '' }).value['PEER_REGIONS']
      ).toEqual({});
    });

    it('parses the JSON of PEER_REGIONS into an object', () => {
      const { error, value } = validate({
        ...validEnv,
        PEER_REGIONS: '{"ru":"https://ru.example.com"}'
      });

      expect(error).toBeUndefined();
      expect(value['PEER_REGIONS']).toEqual({ ru: 'https://ru.example.com' });
    });

    it.each([
      ['an unknown region', '{"eu":"https://eu.example.com"}'],
      ['a plain http URL', '{"ru":"http://ru.example.com"}'],
      ['a value that is not a URL', '{"ru":"ru.example.com"}'],
      ['the own region', '{"intl":"https://intl.example.com"}'],
      ['a value that is not JSON', 'ru=https://ru.example.com']
    ])('refuses a PEER_REGIONS with %s', (_case, peers) => {
      expect(
        validate({ ...validEnv, PEER_REGIONS: peers }).error?.message
      ).toContain('PEER_REGIONS');
    });
  });

  describe('captcha provider', () => {
    const turnstileKeys = {
      TURNSTILE_SITE_KEY: 'site',
      TURNSTILE_SECRET_KEY: 'secret'
    };

    function messageOf(env: Record<string, string>): string | undefined {
      return configValidationSchema.validate(env, options).error?.message;
    }

    it('accepts no provider and no keys, and an empty provider', () => {
      expect(messageOf(validEnv)).toBeUndefined();
      expect(messageOf({ ...validEnv, CAPTCHA_PROVIDER: '' })).toBeUndefined();
    });

    it('accepts the selected provider with all its keys', () => {
      expect(
        messageOf({
          ...validEnv,
          CAPTCHA_PROVIDER: 'turnstile',
          ...turnstileKeys
        })
      ).toBeUndefined();
    });

    it('refuses a provider outside the list', () => {
      expect(
        messageOf({ ...validEnv, CAPTCHA_PROVIDER: 'recaptcha' })
      ).toContain('CAPTCHA_PROVIDER');
    });

    it.each([
      [{}, 'TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY'],
      [{ TURNSTILE_SITE_KEY: 'site' }, 'TURNSTILE_SECRET_KEY'],
      [
        { TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: '' },
        'TURNSTILE_SECRET_KEY'
      ]
    ])('refuses the selected provider with keys %j', (keys, missing) => {
      expect(
        messageOf({ ...validEnv, CAPTCHA_PROVIDER: 'turnstile', ...keys })
      ).toBe(`CAPTCHA_PROVIDER turnstile requires ${missing}`);
    });

    it.each([
      [turnstileKeys, 'TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY'],
      [{ TURNSTILE_SECRET_KEY: 'secret' }, 'TURNSTILE_SECRET_KEY']
    ])('refuses keys %j of a provider that is not selected', (keys, stray) => {
      expect(messageOf({ ...validEnv, ...keys })).toBe(
        `${stray} set, but CAPTCHA_PROVIDER is not turnstile`
      );
    });
  });

  describe('integrations outside the region of the cell', () => {
    const ruEnv = { ...validEnv, DATA_REGION: 'ru' };

    function messageOf(env: Record<string, string>): string | undefined {
      return configValidationSchema.validate(env, options).error?.message;
    }

    it.each([
      ['intl', 'YOOKASSA_SHOP_ID', 'yookassa'],
      ['intl', 'YOOKASSA_SECRET_KEY', 'yookassa'],
      ['ru', 'PADDLE_API_KEY', 'paddle'],
      ['ru', 'PADDLE_WEBHOOK_SECRET', 'paddle'],
      ['ru', 'PADDLE_CLIENT_TOKEN', 'paddle'],
      ['ru', 'GOOGLE_CLIENT_ID', 'googleOAuth'],
      ['ru', 'GOOGLE_CLIENT_SECRET', 'googleOAuth'],
      ['ru', 'FACEBOOK_CLIENT_ID', 'facebookOAuth'],
      ['ru', 'FACEBOOK_CLIENT_SECRET', 'facebookOAuth']
    ])('refuses a %s cell with %s set', (region, key, integration) => {
      expect(
        messageOf({ ...validEnv, DATA_REGION: region, [key]: 'value' })
      ).toBe(
        `${integration} may not run in DATA_REGION ${region} (${key} set)`
      );
    });

    it('refuses a ru cell with the Turnstile captcha', () => {
      expect(
        messageOf({
          ...ruEnv,
          CAPTCHA_PROVIDER: 'turnstile',
          TURNSTILE_SITE_KEY: 'site',
          TURNSTILE_SECRET_KEY: 'secret'
        })
      ).toBe(
        'turnstile may not run in DATA_REGION ru (TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY set)'
      );
    });

    it('accepts the integrations of each region', () => {
      expect(
        messageOf({
          ...validEnv,
          PADDLE_API_KEY: 'key',
          PADDLE_WEBHOOK_SECRET: 'secret',
          CAPTCHA_PROVIDER: 'turnstile',
          TURNSTILE_SITE_KEY: 'site',
          TURNSTILE_SECRET_KEY: 'secret',
          GOOGLE_CLIENT_ID: 'id',
          FACEBOOK_CLIENT_ID: 'id',
          VK_CLIENT_ID: 'id'
        })
      ).toBeUndefined();
      expect(
        messageOf({
          ...ruEnv,
          YOOKASSA_SHOP_ID: 'shop',
          YOOKASSA_SECRET_KEY: 'secret',
          VK_CLIENT_ID: 'id',
          VK_CLIENT_SECRET: 'secret'
        })
      ).toBeUndefined();
    });

    it('treats an empty value as not set', () => {
      expect(
        messageOf({ ...ruEnv, PADDLE_API_KEY: '', GOOGLE_CLIENT_ID: '' })
      ).toBeUndefined();
    });

    it('names every refused integration in one message', () => {
      expect(
        messageOf({
          ...ruEnv,
          PADDLE_API_KEY: 'key',
          PADDLE_WEBHOOK_SECRET: 'secret',
          GOOGLE_CLIENT_ID: 'id'
        })
      ).toBe(
        'paddle may not run in DATA_REGION ru (PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET set); googleOAuth may not run in DATA_REGION ru (GOOGLE_CLIENT_ID set)'
      );
    });

    it('requires SMTP_REGION when SMTP_HOST is set', () => {
      expect(messageOf({ ...validEnv, SMTP_HOST: 'smtp.example.com' })).toBe(
        'SMTP_REGION is required when SMTP_HOST is set'
      );
      expect(
        messageOf({
          ...validEnv,
          SMTP_HOST: 'smtp.example.com',
          SMTP_REGION: ''
        })
      ).toBe('SMTP_REGION is required when SMTP_HOST is set');
      expect(messageOf({ ...validEnv, SMTP_REGION: 'ru' })).toBeUndefined();
    });

    it('refuses an SMTP provider outside Russia for a ru cell', () => {
      expect(
        messageOf({
          ...ruEnv,
          SMTP_HOST: 'smtp.example.com',
          SMTP_REGION: 'intl'
        })
      ).toBe('an SMTP provider in intl may not serve DATA_REGION ru');
      expect(
        messageOf({
          ...ruEnv,
          SMTP_HOST: 'smtp.example.com',
          SMTP_REGION: 'ru'
        })
      ).toBeUndefined();
    });

    it('accepts an SMTP provider of either region for an intl cell', () => {
      for (const smtpRegion of ['intl', 'ru']) {
        expect(
          messageOf({
            ...validEnv,
            SMTP_HOST: 'smtp.example.com',
            SMTP_REGION: smtpRegion
          })
        ).toBeUndefined();
      }
    });

    it('refuses an unknown SMTP_REGION', () => {
      expect(
        messageOf({
          ...validEnv,
          SMTP_HOST: 'smtp.example.com',
          SMTP_REGION: 'eu'
        })
      ).toContain('SMTP_REGION');
    });
  });
});
