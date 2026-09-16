import {
  DEFAULT_SESSION_ABSOLUTE_MAX_MS,
  MIN_JWT_EXPIRATION_SECONDS
} from '@app/shared/constants';
import { configValidationSchema } from './config-validation.schema';

// Mirrors the validationOptions ConfigModule uses in core.module.ts.
const options = { allowUnknown: true, abortEarly: false };

const validEnv = {
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
});
