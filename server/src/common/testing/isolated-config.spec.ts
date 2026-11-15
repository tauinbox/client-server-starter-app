import { isolatedConfig } from './isolated-config';

describe('isolatedConfig', () => {
  const PROBE_KEY = 'ISOLATED_CONFIG_PROBE';

  beforeEach(() => {
    process.env[PROBE_KEY] = 'from-process-env';
  });

  afterEach(() => {
    delete process.env[PROBE_KEY];
  });

  it('does not read a key from process.env', () => {
    const config = isolatedConfig();

    expect(config.get(PROBE_KEY)).toBeUndefined();
    expect(() => config.getOrThrow<string>(PROBE_KEY)).toThrow(PROBE_KEY);
  });

  it('reads the values it was given', () => {
    expect(isolatedConfig({ [PROBE_KEY]: 'given' }).get(PROBE_KEY)).toBe(
      'given'
    );
  });
});
