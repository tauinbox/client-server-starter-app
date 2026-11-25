import { Test, TestingModule } from '@nestjs/testing';
import {
  FeatureFlagChangedListener,
  FLAGS_BROADCAST_COALESCE_MS
} from './feature-flag-changed.listener';
import { FeatureFlagResolverService } from '../services/feature-flag-resolver.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { settingsChangedEvent } from '../../core/settings-change-log/testing/settings-changed-event';

describe('FeatureFlagChangedListener', () => {
  let listener: FeatureFlagChangedListener;
  let resolver: { invalidateAll: jest.Mock };
  let notifications: { pushToAll: jest.Mock };
  let manager: { query: jest.Mock };
  let settings: { query: jest.Mock };
  const event = (change: Parameters<typeof settingsChangedEvent>[0]) =>
    // @ts-expect-error the listener calls only `query` of the managers
    settingsChangedEvent(change, { managers: { regional: manager, settings } });
  const flagChange = () => event({ tables: ['feature_flags'] });

  beforeEach(async () => {
    manager = { query: jest.fn().mockResolvedValue([]) };
    settings = { query: jest.fn().mockResolvedValue([]) };
    resolver = { invalidateAll: jest.fn().mockResolvedValue(undefined) };
    notifications = { pushToAll: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureFlagChangedListener,
        { provide: FeatureFlagResolverService, useValue: resolver },
        { provide: NotificationsService, useValue: notifications }
      ]
    }).compile();

    listener = module.get(FeatureFlagChangedListener);
  });

  describe('which changes it applies', () => {
    afterEach(() => listener.onModuleDestroy());

    it.each([
      ['a flag row', { tables: ['feature_flags' as const] }],
      ['a rule row', { tables: ['feature_flag_rules' as const] }],
      ['a rebase', { all: true }]
    ])('drops the flag cache for %s', async (_case, change) => {
      await listener.handleSettingsChanged(event(change));

      expect(resolver.invalidateAll).toHaveBeenCalledTimes(1);
    });

    it('deletes the members of removed rules before it drops the cache', async () => {
      manager.query.mockImplementation((sql: string) =>
        Promise.resolve(sql.startsWith('SELECT') ? [{ id: 'rule-gone' }] : [])
      );

      await listener.handleSettingsChanged(
        event({ tables: ['feature_flag_rules'] })
      );

      expect(settings.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM "feature_flag_rules"'),
        [['rule-gone']]
      );
      expect(manager.query).toHaveBeenLastCalledWith(
        expect.stringContaining('DELETE FROM "feature_flag_rule_users"'),
        [['rule-gone']]
      );
      expect(manager.query.mock.invocationCallOrder.at(-1)).toBeLessThan(
        resolver.invalidateAll.mock.invocationCallOrder[0]
      );
    });

    it('ignores a change of other settings', async () => {
      await listener.handleSettingsChanged(
        event({ tables: ['roles', 'plans'] })
      );

      expect(resolver.invalidateAll).not.toHaveBeenCalled();
      expect(manager.query).not.toHaveBeenCalled();
    });
  });

  describe('flag-change broadcast coalescing', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      listener.onModuleDestroy();
      jest.useRealTimers();
    });

    it('invalidates all caches and broadcasts once after the coalesce window', async () => {
      await listener.handleSettingsChanged(flagChange());
      expect(resolver.invalidateAll).toHaveBeenCalled();
      expect(notifications.pushToAll).not.toHaveBeenCalled();

      jest.advanceTimersByTime(FLAGS_BROADCAST_COALESCE_MS);
      expect(notifications.pushToAll).toHaveBeenCalledTimes(1);
      expect(notifications.pushToAll).toHaveBeenCalledWith({
        type: 'feature_flags_updated'
      });
    });

    it('collapses a burst of changes into one broadcast but invalidates per event', async () => {
      await listener.handleSettingsChanged(flagChange());
      await listener.handleSettingsChanged(flagChange());
      expect(resolver.invalidateAll).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(FLAGS_BROADCAST_COALESCE_MS);
      expect(notifications.pushToAll).toHaveBeenCalledTimes(1);
    });

    it('broadcasts again for a change after the window has elapsed', async () => {
      await listener.handleSettingsChanged(flagChange());
      jest.advanceTimersByTime(FLAGS_BROADCAST_COALESCE_MS);
      expect(notifications.pushToAll).toHaveBeenCalledTimes(1);

      await listener.handleSettingsChanged(flagChange());
      jest.advanceTimersByTime(FLAGS_BROADCAST_COALESCE_MS);
      expect(notifications.pushToAll).toHaveBeenCalledTimes(2);
    });

    it('cancels a pending broadcast on module destroy', async () => {
      await listener.handleSettingsChanged(flagChange());
      listener.onModuleDestroy();
      jest.advanceTimersByTime(FLAGS_BROADCAST_COALESCE_MS);
      expect(notifications.pushToAll).not.toHaveBeenCalled();
    });
  });
});
