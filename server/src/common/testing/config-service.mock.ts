import { ConfigService } from '@nestjs/config';

/**
 * Builds a minimal ConfigService for unit tests that only read configuration.
 * `getOrThrow` resolves from the supplied map (throwing on a missing key);
 * `get` returns the mapped value or falls back to 'development'. Only these two
 * members are implemented, so the object is returned as a partial mock without
 * a double cast.
 */
export function createMockConfigService(
  env: Record<string, string>
): ConfigService {
  const config = {
    get: jest.fn((key: string) => env[key] ?? 'development'),
    getOrThrow: jest.fn((key: string) => {
      const value = env[key];
      if (value === undefined) {
        throw new Error(`Configuration key "${key}" is not defined`);
      }
      return value;
    })
  };

  // @ts-expect-error - partial ConfigService: tests only read get/getOrThrow
  return config;
}
