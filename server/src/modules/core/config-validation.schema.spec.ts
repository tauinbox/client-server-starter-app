import { configValidationSchema } from './config-validation.schema';

// Mirrors the validationOptions ConfigModule uses in core.module.ts.
const options = { allowUnknown: true, abortEarly: false };

const validEnv = {
  DB_HOST: 'localhost',
  DB_NAME: 'db',
  DB_USER: 'user',
  DB_PASSWORD: 'pass',
  JWT_SECRET: 'a-secret-of-sufficient-length',
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

  it('rejects a missing JWT_SECRET when the algorithm is HS256', () => {
    const env: Record<string, string> = { ...validEnv };
    delete env['JWT_SECRET'];

    const { error } = configValidationSchema.validate(env, options);

    expect(error?.message).toContain('JWT_SECRET');
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
