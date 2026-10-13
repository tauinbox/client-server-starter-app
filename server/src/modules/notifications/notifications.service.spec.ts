import { HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MAX_SSE_STREAMS_PER_USER } from '@app/shared/constants';
import {
  SSE_CONNECTIONS_REF,
  type SseConnectionsRef
} from '../core/metrics/metrics.module';
import { NotificationsService } from './notifications.service';
import { CaslAbilityFactory } from '../auth/casl/casl-ability.factory';
import type { AppAbility } from '../auth/casl/app-ability';
import { PermissionService } from '../auth/services/permission.service';
import { RefreshTokenService } from '../auth/services/refresh-token.service';
import { SSE_HEARTBEAT_INTERVAL_MS } from './notifications.constants';
import { NotificationsBus } from './notifications-bus';
import type { BusPeer } from './notifications-bus';

const mockSseRef: SseConnectionsRef = { getCount: () => 0 };
const HEARTBEAT_MS = 1_000;

class FakeBus extends NotificationsBus {
  peer: BusPeer | null = null;
  remoteUserIds: string[] | null = null;
  readonly publish = jest.fn<void, Parameters<NotificationsBus['publish']>>();
  readonly userConnected = jest.fn<void, [string]>();
  readonly userDisconnected = jest.fn<void, [string]>();

  attach(peer: BusPeer): void {
    this.peer = peer;
  }

  connectedUserIds(): Promise<string[] | null> {
    return Promise.resolve(this.remoteUserIds);
  }
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let bus: FakeBus;
  let caslAbilityFactory: { resolveForUser: jest.Mock };
  let refreshTokenService: { hasLiveSession: jest.Mock };
  let permissionService: { filterGrantHolders: jest.Mock };
  /** userIds the mocked ability grants search:User to */
  let usersWithListAccess: Set<string>;

  beforeEach(async () => {
    mockSseRef.getCount = () => 0;
    usersWithListAccess = new Set<string>();
    bus = new FakeBus();

    permissionService = {
      filterGrantHolders: jest
        .fn()
        .mockImplementation((userIds: string[]) => Promise.resolve(userIds))
    };

    caslAbilityFactory = {
      resolveForUser: jest.fn().mockImplementation((userId: string) =>
        Promise.resolve({
          ability: { can: () => usersWithListAccess.has(userId) },
          roles: [],
          permissions: []
        })
      )
    };

    refreshTokenService = {
      hasLiveSession: jest.fn().mockResolvedValue(true)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: SSE_CONNECTIONS_REF, useValue: mockSseRef },
        { provide: CaslAbilityFactory, useValue: caslAbilityFactory },
        { provide: PermissionService, useValue: permissionService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
        { provide: SSE_HEARTBEAT_INTERVAL_MS, useValue: HEARTBEAT_MS },
        { provide: NotificationsBus, useValue: bus }
      ]
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  describe('openStream', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const collect = (userId: string, sessionId: string) => {
      const frames: unknown[] = [];
      let completed = false;
      const subscription = service
        .openStream(userId, sessionId, 'conn-1')
        .subscribe({
          next: (frame) => frames.push(frame.data),
          complete: () => {
            completed = true;
          }
        });
      return {
        frames,
        subscription,
        isCompleted: () => completed
      };
    };

    it('sends one heartbeat frame at once, before the first session check', () => {
      const stream = collect('user-1', 'session-1');

      expect(stream.frames).toEqual(['']);
      expect(refreshTokenService.hasLiveSession).not.toHaveBeenCalled();
      stream.subscription.unsubscribe();
    });

    it('sends a heartbeat while the session is live and keeps the stream open', async () => {
      const stream = collect('user-1', 'session-1');

      await jest.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);

      expect(refreshTokenService.hasLiveSession).toHaveBeenCalledWith(
        'session-1'
      );
      expect(stream.frames).toEqual(['', '', '']);
      expect(stream.isCompleted()).toBe(false);
      stream.subscription.unsubscribe();
    });

    it('sends session_invalidated and completes when the session has ended', async () => {
      const stream = collect('user-1', 'session-1');
      service.push('user-1', { type: 'feature_flags_updated' });

      refreshTokenService.hasLiveSession.mockResolvedValue(false);
      await jest.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);

      expect(stream.frames).toEqual([
        '',
        { type: 'feature_flags_updated' },
        { type: 'session_invalidated' }
      ]);
      expect(stream.isCompleted()).toBe(true);
      expect(refreshTokenService.hasLiveSession).toHaveBeenCalledTimes(1);
      expect(mockSseRef.getCount()).toBe(0);
    });

    it('keeps the stream open when the session check fails', async () => {
      const stream = collect('user-1', 'session-1');

      refreshTokenService.hasLiveSession.mockRejectedValueOnce(
        new Error('connection refused')
      );
      await jest.advanceTimersByTimeAsync(HEARTBEAT_MS);

      expect(stream.frames).toEqual(['', '']);
      expect(stream.isCompleted()).toBe(false);
      stream.subscription.unsubscribe();
    });

    it('removes the connection when the subscriber goes away', () => {
      const stream = collect('user-1', 'session-1');
      expect(mockSseRef.getCount()).toBe(1);

      stream.subscription.unsubscribe();

      expect(mockSseRef.getCount()).toBe(0);
    });

    it('refuses a stream over the limit of one user with 429 and counts users apart', () => {
      for (let i = 0; i < MAX_SSE_STREAMS_PER_USER; i++) {
        service.openStream('user-1', 'session-1', `conn-${i}`);
      }

      let error: unknown;
      try {
        service.openStream('user-1', 'session-1', 'conn-over');
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS
      );
      expect(mockSseRef.getCount()).toBe(MAX_SSE_STREAMS_PER_USER);

      service.openStream('user-2', 'session-2', 'conn-other');
      service.closeStream('user-1', 'conn-0');
      service.openStream('user-1', 'session-1', 'conn-again');
      expect(mockSseRef.getCount()).toBe(MAX_SSE_STREAMS_PER_USER + 1);
    });
  });

  it('should create a stream for a new userId/connectionId', () => {
    const subject = service.createStream('user-1', 'conn-1');
    expect(subject).toBeDefined();
  });

  it('should wire getCount to return live connection count', () => {
    service.createStream('user-1', 'conn-1');
    expect(mockSseRef.getCount()).toBe(1);
  });

  it('should emit events pushed to a specific user', (done) => {
    const subject = service.createStream('user-2', 'conn-2');
    const received: unknown[] = [];

    subject.subscribe({
      next: (event) => {
        received.push(event);
        if (received.length === 1) {
          expect(received[0]).toEqual({
            data: { type: 'session_invalidated' }
          });
          done();
        }
      }
    });

    service.push('user-2', { type: 'session_invalidated' });
  });

  it('should fan out to multiple connections for the same user', () => {
    const subject1 = service.createStream('user-3', 'conn-a');
    const subject2 = service.createStream('user-3', 'conn-b');

    const received1: unknown[] = [];
    const received2: unknown[] = [];
    subject1.subscribe((e) => received1.push(e));
    subject2.subscribe((e) => received2.push(e));

    service.push('user-3', { type: 'permissions_updated' });

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });

  it('should push to all connections via pushToAll', () => {
    const subA = service.createStream('user-4', 'conn-1');
    const subB = service.createStream('user-5', 'conn-1');

    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    subA.subscribe((e) => receivedA.push(e));
    subB.subscribe((e) => receivedB.push(e));

    service.pushToAll({
      type: 'user_crud_events',
      action: 'created',
      userId: 'new-user'
    });

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(1);
  });

  describe('pushToAuthorized', () => {
    const crudEvent = {
      type: 'user_crud_events',
      action: 'created',
      userId: 'new-user'
    } as const;
    const canSearchUsers = (ability: AppAbility) =>
      ability.can('search', 'User');
    const searchUser = { action: 'search', subject: 'User' } as const;

    it('resolves only the abilities of the grant holders', async () => {
      service.createStream('admin-3', 'conn-1');
      service.createStream('basic-3', 'conn-1');
      bus.remoteUserIds = ['remote-basic'];
      usersWithListAccess.add('admin-3');
      permissionService.filterGrantHolders.mockResolvedValue(['admin-3']);

      await service.pushToAuthorized(crudEvent, canSearchUsers, searchUser);

      expect(permissionService.filterGrantHolders).toHaveBeenCalledWith(
        ['admin-3', 'basic-3', 'remote-basic'],
        'search',
        'User'
      );
      expect(caslAbilityFactory.resolveForUser.mock.calls).toEqual([
        ['admin-3']
      ]);
      expect(bus.publish).toHaveBeenCalledWith({
        userIds: ['admin-3'],
        event: crudEvent
      });
    });

    it('should fail closed when the grant holder lookup throws', async () => {
      const subject = service.createStream('admin-4', 'conn-1');
      usersWithListAccess.add('admin-4');
      permissionService.filterGrantHolders.mockRejectedValue(
        new Error('db down')
      );
      const received: unknown[] = [];
      subject.subscribe((e) => received.push(e));

      await expect(
        service.pushToAuthorized(crudEvent, canSearchUsers, searchUser)
      ).resolves.toBeUndefined();
      expect(received).toEqual([]);
      expect(caslAbilityFactory.resolveForUser).not.toHaveBeenCalled();
    });

    it('resolves at most 50 abilities at a time', async () => {
      const userIds = Array.from({ length: 120 }, (_, i) => `admin-${i}`);
      bus.remoteUserIds = userIds;
      userIds.forEach((userId) => usersWithListAccess.add(userId));
      let running = 0;
      let peak = 0;
      caslAbilityFactory.resolveForUser.mockImplementation(
        async (userId: string) => {
          peak = Math.max(peak, ++running);
          await Promise.resolve();
          running--;
          return {
            ability: { can: () => usersWithListAccess.has(userId) },
            roles: [],
            permissions: []
          };
        }
      );

      await service.pushToAuthorized(crudEvent, canSearchUsers, searchUser);

      expect(peak).toBe(50);
      expect(bus.publish).toHaveBeenCalledWith({
        userIds,
        event: crudEvent
      });
    });

    it('should deliver only to users whose ability satisfies the check', async () => {
      const adminSub = service.createStream('admin-1', 'conn-1');
      const basicSub = service.createStream('basic-1', 'conn-1');
      usersWithListAccess.add('admin-1');

      const adminReceived: unknown[] = [];
      const basicReceived: unknown[] = [];
      adminSub.subscribe((e) => adminReceived.push(e));
      basicSub.subscribe((e) => basicReceived.push(e));

      await service.pushToAuthorized(crudEvent, canSearchUsers, searchUser);

      expect(adminReceived).toEqual([{ data: crudEvent }]);
      expect(basicReceived).toEqual([]);
    });

    it('should fail closed when ability resolution throws', async () => {
      const subject = service.createStream('admin-2', 'conn-1');
      usersWithListAccess.add('admin-2');
      caslAbilityFactory.resolveForUser.mockRejectedValue(new Error('db down'));

      const received: unknown[] = [];
      subject.subscribe((e) => received.push(e));

      await expect(
        service.pushToAuthorized(crudEvent, canSearchUsers, searchUser)
      ).resolves.toBeUndefined();
      expect(received).toEqual([]);
    });

    it('should resolve abilities per push so permission changes take effect', async () => {
      const subject = service.createStream('user-a', 'conn-1');
      const received: unknown[] = [];
      subject.subscribe((e) => received.push(e));

      await service.pushToAuthorized(crudEvent, canSearchUsers, searchUser);
      expect(received).toHaveLength(0);

      usersWithListAccess.add('user-a');
      await service.pushToAuthorized(crudEvent, canSearchUsers, searchUser);
      expect(received).toHaveLength(1);
    });

    it('checks the users of other instances here and publishes only the allowed ones', async () => {
      const local = service.createStream('local-admin', 'conn-1');
      const received: unknown[] = [];
      local.subscribe((e) => received.push(e));
      bus.remoteUserIds = ['remote-admin', 'remote-basic', 'local-admin'];
      usersWithListAccess.add('local-admin');
      usersWithListAccess.add('remote-admin');

      await service.pushToAuthorized(crudEvent, canSearchUsers, searchUser);

      expect(received).toEqual([{ data: crudEvent }]);
      expect(bus.publish).toHaveBeenCalledTimes(1);
      expect(bus.publish).toHaveBeenCalledWith({
        userIds: ['local-admin', 'remote-admin'],
        event: crudEvent
      });
      expect(caslAbilityFactory.resolveForUser).toHaveBeenCalledTimes(3);
    });

    it('publishes nothing when no user is allowed', async () => {
      service.createStream('basic-2', 'conn-1');
      bus.remoteUserIds = ['remote-basic'];

      await service.pushToAuthorized(crudEvent, canSearchUsers, searchUser);

      expect(bus.publish).not.toHaveBeenCalled();
    });
  });

  describe('bus', () => {
    const event = { type: 'feature_flags_updated' } as const;

    it('publishes each push for the other instances', () => {
      service.push('user-1', event);
      service.pushToAll(event);

      expect(bus.publish.mock.calls).toEqual([
        [{ userIds: ['user-1'], event }],
        [{ event }]
      ]);
    });

    it('delivers a push from another instance to the streams of this one', () => {
      const first = service.createStream('user-1', 'conn-1');
      const second = service.createStream('user-2', 'conn-1');
      const firstReceived: unknown[] = [];
      const secondReceived: unknown[] = [];
      first.subscribe((e) => firstReceived.push(e));
      second.subscribe((e) => secondReceived.push(e));

      bus.peer?.deliver({ userIds: ['user-1', 'absent'], event });
      bus.peer?.deliver({ event });

      expect(firstReceived).toEqual([{ data: event }, { data: event }]);
      expect(secondReceived).toEqual([{ data: event }]);
      expect(bus.publish).not.toHaveBeenCalled();
    });

    it('registers a user on the first stream and removes it after the last', () => {
      service.createStream('user-1', 'conn-1');
      service.createStream('user-1', 'conn-2');
      expect(bus.userConnected.mock.calls).toEqual([['user-1']]);
      expect(bus.peer?.localUserIds()).toEqual(['user-1']);

      service.closeStream('user-1', 'conn-1');
      expect(bus.userDisconnected).not.toHaveBeenCalled();
      service.closeStream('user-1', 'conn-2');
      expect(bus.userDisconnected.mock.calls).toEqual([['user-1']]);
      expect(bus.peer?.localUserIds()).toEqual([]);
    });
  });

  it('should complete the stream and remove the entry on closeStream', () => {
    const subject = service.createStream('user-6', 'conn-1');

    let completed = false;
    subject.subscribe({
      complete: () => {
        completed = true;
      }
    });

    service.closeStream('user-6', 'conn-1');

    expect(completed).toBe(true);

    // After close, push should not throw
    expect(() =>
      service.push('user-6', { type: 'session_invalidated' })
    ).not.toThrow();
  });

  it('should reflect actual connection count across multiple open/close cycles', () => {
    service.createStream('user-8', 'conn-1');
    service.createStream('user-8', 'conn-2');
    expect(mockSseRef.getCount()).toBe(2);

    service.closeStream('user-8', 'conn-1');
    expect(mockSseRef.getCount()).toBe(1);

    service.closeStream('user-8', 'conn-2');
    expect(mockSseRef.getCount()).toBe(0);
  });

  it('should not change count when closing a non-existent connection', () => {
    service.createStream('user-9', 'conn-1');
    expect(mockSseRef.getCount()).toBe(1);

    service.closeStream('unknown-user', 'conn-1');
    expect(mockSseRef.getCount()).toBe(1);
  });
});
