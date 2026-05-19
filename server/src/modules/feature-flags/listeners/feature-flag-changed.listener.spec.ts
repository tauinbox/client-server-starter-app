import { Test, TestingModule } from '@nestjs/testing';
import { FeatureFlagChangedListener } from './feature-flag-changed.listener';
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

  it('invalidates all caches and broadcasts on flag change', async () => {
    await listener.handleFeatureFlagChanged(
      new FeatureFlagChangedEvent('new-dashboard', 'updated')
    );
    expect(resolver.invalidateAll).toHaveBeenCalled();
    expect(notifications.pushToAll).toHaveBeenCalledWith({
      type: 'feature_flags_updated'
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
