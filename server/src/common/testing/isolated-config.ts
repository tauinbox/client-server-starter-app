import { ConfigService } from '@nestjs/config';

/**
 * A real ConfigService that reads only `values`. The plain constructor falls
 * back to process.env for a key that `values` does not hold, so a test of a
 * missing key then passes or fails with the environment of the shell or of
 * the CI job. `createMockConfigService` is a fake with its own `get` default;
 * use this helper when the test needs the real lookup.
 */
export function isolatedConfig(
  values: Record<string, unknown> = {}
): ConfigService {
  const config = new ConfigService(values);

  // ConfigModule.forRoot({ skipProcessEnv: true }) sets the same switch, also
  // through an untyped reference: its setter is private in the typings.
  Reflect.set(config, 'skipProcessEnv', true);

  return config;
}
