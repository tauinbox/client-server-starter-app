import { Test, TestingModule } from '@nestjs/testing';
import {
  FeatureFlagChangedListener,
  FLAGS_BROADCAST_COALESCE_MS
} from './feature-flag-changed.listener';
import { FeatureFlagResolverService } from '../services/feature-flag-resolver.service';
import { NotificationsService } from '../../notifications/notifications.service';

describe('FeatureFlagChangedListener', () => {
  let listener: FeatureFlagChangedListener;
  let resolver: { invalidateAll: jest.Mock };
  let notifications: { pushToAll: jest.Mock };

  beforeEach(async () => {
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

  describe('flag-change broadcast coalescing', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      listener.onModuleDestroy();
      jest.useRealTimers();
    });

    it('invalidates all caches and broadcasts once after the coalesce window', async () => {
      await listener.handleFeatureFlagChanged();
      expect(resolver.invalidateAll).toHaveBeenCalled();
      expect(notifications.pushToAll).not.toHaveBeenCalled();

      jest.advanceTimersByTime(FLAGS_BROADCAST_COALESCE_MS);
      expect(notifications.pushToAll).toHaveBeenCalledTimes(1);
      expect(notifications.pushToAll).toHaveBeenCalledWith({
        type: 'feature_flags_updated'
      });
    });

    it('collapses a burst of changes into one broadcast but invalidates per event', async () => {
      await listener.handleFeatureFlagChanged();
      await listener.handleFeatureFlagChanged();
      expect(resolver.invalidateAll).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(FLAGS_BROADCAST_COALESCE_MS);
      expect(notifications.pushToAll).toHaveBeenCalledTimes(1);
    });

    it('broadcasts again for a change after the window has elapsed', async () => {
      await listener.handleFeatureFlagChanged();
      jest.advanceTimersByTime(FLAGS_BROADCAST_COALESCE_MS);
      expect(notifications.pushToAll).toHaveBeenCalledTimes(1);

      await listener.handleFeatureFlagChanged();
      jest.advanceTimersByTime(FLAGS_BROADCAST_COALESCE_MS);
      expect(notifications.pushToAll).toHaveBeenCalledTimes(2);
    });

    it('cancels a pending broadcast on module destroy', async () => {
      await listener.handleFeatureFlagChanged();
      listener.onModuleDestroy();
      jest.advanceTimersByTime(FLAGS_BROADCAST_COALESCE_MS);
      expect(notifications.pushToAll).not.toHaveBeenCalled();
    });
  });
});
