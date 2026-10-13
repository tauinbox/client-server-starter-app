import { Logger } from '@nestjs/common';
import { RedisNotificationsBus } from './redis-notifications-bus';

describe('RedisNotificationsBus without a reachable Redis', () => {
  let bus: RedisNotificationsBus;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // Port 1 refuses the connection at once.
    bus = new RedisNotificationsBus('redis://127.0.0.1:1');
    bus.attach({ deliver: jest.fn(), localUserIds: () => ['user-1'] });
    bus.onModuleInit();
  });

  afterEach(async () => {
    await bus.onModuleDestroy();
    jest.restoreAllMocks();
  });

  it('reports no registry instead of waiting, so the caller falls back to its own streams', async () => {
    const started = Date.now();

    await expect(bus.connectedUserIds()).resolves.toBeNull();

    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('does not throw on a publish or a registry write', () => {
    expect(() => {
      bus.publish({ event: { type: 'feature_flags_updated' } });
      bus.userConnected('user-1');
      bus.userDisconnected('user-1');
    }).not.toThrow();
  });
});
