import { MAX_FAILED_ATTEMPTS } from '@app/shared/constants';
import { MemoryThrottlerStorage } from './memory-throttler.storage';
import { buildThrottlerOptions } from './throttler-options';

describe('buildThrottlerOptions', () => {
  it('installs a storage that supports refunds when no Redis URL is configured', () => {
    const { storage } = buildThrottlerOptions(undefined);

    expect(storage).toBeInstanceOf(MemoryThrottlerStorage);
  });

  it('keeps the login window effectively disabled outside the login route', () => {
    const { throttlers } = buildThrottlerOptions(undefined);
    const loginWindow = throttlers.find(
      (throttler) => throttler.name === 'login-long-window'
    );

    expect(loginWindow?.limit).toBe(MAX_FAILED_ATTEMPTS * 1000);
  });
});
