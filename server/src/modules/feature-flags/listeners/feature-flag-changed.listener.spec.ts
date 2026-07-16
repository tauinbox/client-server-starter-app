import { Test, TestingModule } from '@nestjs/testing';
import {
  FeatureFlagChangedListener,
  FLAGS_BROADCAST_COALESCE_MS
} from './feature-flag-changed.listener';
import { FeatureFlagChangedEvent } from '../events/feature-flag-changed.event';
import { FeatureFlagResolverService } from '../services/feature-flag-resolver.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { UserRoleChangedEvent } from '../../auth/events/user-role-changed.event';
import { UserDeletedEvent } from '../../users/events/user-deleted.event';

describe('FeatureFlagChangedListener', () => {
  let listener: FeatureFlagChangedListener;
  let resolver: {
    invalidateAll: jest.Mock;
    invalidateUser: jest.Mock;
  };
  let notifications: { push: jest.Mock; pushToAll: jest.Mock };

  beforeEach(async () => {
    resolver = {
      invalidateAll: jest.fn().mockResolvedValue(undefined),
      invalidateUser: jest.fn().mockResolvedValue(undefined)
    };
    notifications = { push: jest.fn(), pushToAll: jest.fn() };
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
      await listener.handleFeatureFlagChanged(
        new FeatureFlagChangedEvent('new-dashboard', 'updated')
      );
      expect(resolver.invalidateAll).toHaveBeenCalled();
      expect(notifications.pushToAll).not.toHaveBeenCalled();

      jest.advanceTimersByTime(FLAGS_BROADCAST_COALESCE_MS);
      expect(notifications.pushToAll).toHaveBeenCalledTimes(1);
      expect(notifications.pushToAll).toHaveBeenCalledWith({
        type: 'feature_flags_updated'
      });
    });

    it('collapses a burst of changes into one broadcast but invalidates per event', async () => {
      await listener.handleFeatureFlagChanged(
        new FeatureFlagChangedEvent('new-dashboard', 'updated')
      );
      await listener.handleFeatureFlagChanged(
        new FeatureFlagChangedEvent('new-dashboard', 'rules-replaced')
      );
      expect(resolver.invalidateAll).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(FLAGS_BROADCAST_COALESCE_MS);
      expect(notifications.pushToAll).toHaveBeenCalledTimes(1);
    });

    it('broadcasts again for a change after the window has elapsed', async () => {
      await listener.handleFeatureFlagChanged(
        new FeatureFlagChangedEvent('new-dashboard', 'toggled')
      );
      jest.advanceTimersByTime(FLAGS_BROADCAST_COALESCE_MS);
      expect(notifications.pushToAll).toHaveBeenCalledTimes(1);

      await listener.handleFeatureFlagChanged(
        new FeatureFlagChangedEvent('beta-export', 'toggled')
      );
      jest.advanceTimersByTime(FLAGS_BROADCAST_COALESCE_MS);
      expect(notifications.pushToAll).toHaveBeenCalledTimes(2);
    });

    it('cancels a pending broadcast on module destroy', async () => {
      await listener.handleFeatureFlagChanged(
        new FeatureFlagChangedEvent('new-dashboard', 'deleted')
      );
      listener.onModuleDestroy();
      jest.advanceTimersByTime(FLAGS_BROADCAST_COALESCE_MS);
      expect(notifications.pushToAll).not.toHaveBeenCalled();
    });
  });

  it('invalidates only the affected user on role change', async () => {
    await listener.handleUserRoleChanged(new UserRoleChangedEvent('u-1'));
    expect(resolver.invalidateUser).toHaveBeenCalledWith('u-1');
    expect(notifications.push).toHaveBeenCalledWith('u-1', {
      type: 'feature_flags_updated'
    });
    expect(notifications.pushToAll).not.toHaveBeenCalled();
  });

  it('invalidates the deleted user’s cache', async () => {
    await listener.handleUserDeleted(new UserDeletedEvent('u-2'));
    expect(resolver.invalidateUser).toHaveBeenCalledWith('u-2');
  });
});
