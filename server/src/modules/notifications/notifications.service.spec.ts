import { Test, TestingModule } from '@nestjs/testing';
import {
  SSE_CONNECTIONS_REF,
  type SseConnectionsRef
} from '../core/metrics/metrics.module';
import { NotificationsService } from './notifications.service';
import { CaslAbilityFactory } from '../auth/casl/casl-ability.factory';
import { RefreshTokenService } from '../auth/services/refresh-token.service';
import { SSE_HEARTBEAT_INTERVAL_MS } from './notifications.constants';

const mockSseRef: SseConnectionsRef = { getCount: () => 0 };
const HEARTBEAT_MS = 1_000;

describe('NotificationsService', () => {
  let service: NotificationsService;
  let caslAbilityFactory: { resolveForUser: jest.Mock };
  let refreshTokenService: { hasLiveSession: jest.Mock };
  /** userIds the mocked ability grants search:User to */
  let usersWithListAccess: Set<string>;

  beforeEach(async () => {
    mockSseRef.getCount = () => 0;
    usersWithListAccess = new Set<string>();

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
        { provide: RefreshTokenService, useValue: refreshTokenService },
        { provide: SSE_HEARTBEAT_INTERVAL_MS, useValue: HEARTBEAT_MS }
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

    it('sends a heartbeat while the session is live and keeps the stream open', async () => {
      const stream = collect('user-1', 'session-1');

      await jest.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);

      expect(refreshTokenService.hasLiveSession).toHaveBeenCalledWith(
        'session-1'
      );
      expect(stream.frames).toEqual(['', '']);
      expect(stream.isCompleted()).toBe(false);
      stream.subscription.unsubscribe();
    });

    it('sends session_invalidated and completes when the session has ended', async () => {
      const stream = collect('user-1', 'session-1');
      service.push('user-1', { type: 'feature_flags_updated' });

      refreshTokenService.hasLiveSession.mockResolvedValue(false);
      await jest.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);

      expect(stream.frames).toEqual([
        { type: 'feature_flags_updated' },
        { type: 'session_invalidated', userId: 'user-1' }
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

      expect(stream.frames).toEqual(['']);
      expect(stream.isCompleted()).toBe(false);
      stream.subscription.unsubscribe();
    });

    it('removes the connection when the subscriber goes away', () => {
      const stream = collect('user-1', 'session-1');
      expect(mockSseRef.getCount()).toBe(1);

      stream.subscription.unsubscribe();

      expect(mockSseRef.getCount()).toBe(0);
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
            data: { type: 'session_invalidated', userId: 'user-2' }
          });
          done();
        }
      }
    });

    service.push('user-2', { type: 'session_invalidated', userId: 'user-2' });
  });

  it('should fan out to multiple connections for the same user', () => {
    const subject1 = service.createStream('user-3', 'conn-a');
    const subject2 = service.createStream('user-3', 'conn-b');

    const received1: unknown[] = [];
    const received2: unknown[] = [];
    subject1.subscribe((e) => received1.push(e));
    subject2.subscribe((e) => received2.push(e));

    service.push('user-3', { type: 'permissions_updated', userId: 'user-3' });

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

    it('should deliver only to users whose ability satisfies the check', async () => {
      const adminSub = service.createStream('admin-1', 'conn-1');
      const basicSub = service.createStream('basic-1', 'conn-1');
      usersWithListAccess.add('admin-1');

      const adminReceived: unknown[] = [];
      const basicReceived: unknown[] = [];
      adminSub.subscribe((e) => adminReceived.push(e));
      basicSub.subscribe((e) => basicReceived.push(e));

      await service.pushToAuthorized(crudEvent, ['search', 'User']);

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
        service.pushToAuthorized(crudEvent, ['search', 'User'])
      ).resolves.toBeUndefined();
      expect(received).toEqual([]);
    });

    it('should resolve abilities per push so permission changes take effect', async () => {
      const subject = service.createStream('user-a', 'conn-1');
      const received: unknown[] = [];
      subject.subscribe((e) => received.push(e));

      await service.pushToAuthorized(crudEvent, ['search', 'User']);
      expect(received).toHaveLength(0);

      usersWithListAccess.add('user-a');
      await service.pushToAuthorized(crudEvent, ['search', 'User']);
      expect(received).toHaveLength(1);
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
      service.push('user-6', { type: 'session_invalidated', userId: 'user-6' })
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
