import { Test, TestingModule } from '@nestjs/testing';
import {
  SSE_CONNECTIONS_REF,
  type SseConnectionsRef
} from '../core/metrics/metrics.module';
import { NotificationsService } from './notifications.service';
import { PermissionService } from '../auth/services/permission.service';
import { CaslAbilityFactory } from '../auth/casl/casl-ability.factory';

const mockSseRef: SseConnectionsRef = { getCount: () => 0 };

describe('NotificationsService', () => {
  let service: NotificationsService;
  let permissionService: {
    getRolesForUser: jest.Mock;
    getPermissionsForUser: jest.Mock;
  };
  let caslAbilityFactory: { createForUser: jest.Mock };
  /** userIds the mocked ability grants search:User to */
  let usersWithListAccess: Set<string>;

  beforeEach(async () => {
    mockSseRef.getCount = () => 0;
    usersWithListAccess = new Set<string>();

    permissionService = {
      getRolesForUser: jest.fn().mockResolvedValue([]),
      getPermissionsForUser: jest.fn().mockResolvedValue([])
    };
    caslAbilityFactory = {
      createForUser: jest
        .fn()
        .mockImplementation((userId: string) =>
          Promise.resolve({ can: () => usersWithListAccess.has(userId) })
        )
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: SSE_CONNECTIONS_REF, useValue: mockSseRef },
        { provide: PermissionService, useValue: permissionService },
        { provide: CaslAbilityFactory, useValue: caslAbilityFactory }
      ]
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
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
      caslAbilityFactory.createForUser.mockRejectedValue(new Error('db down'));

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
