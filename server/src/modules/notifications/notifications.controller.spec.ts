import { EventEmitter } from 'events';
import { firstValueFrom, Subject, take } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import type { JwtAuthRequest } from '../auth/types/auth.request';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: Pick<
    NotificationsService,
    'getOrCreateStream' | 'closeStream'
  > & {
    getOrCreateStream: jest.Mock;
    closeStream: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getOrCreateStream: jest.fn(),
      closeStream: jest.fn()
    };
    // @ts-expect-error partial mock
    controller = new NotificationsController(service);
  });

  const buildReq = (userId: string): JwtAuthRequest => {
    const req = {
      user: {
        userId,
        email: 'a@b.c',
        roles: []
      }
    };
    // @ts-expect-error partial mock
    return req;
  };

  type MockRes = {
    emitter: EventEmitter;
    on: (event: string, listener: (...args: unknown[]) => void) => MockRes;
  };
  const buildRes = (): MockRes => {
    const emitter = new EventEmitter();
    const res: MockRes = {
      emitter,
      on: (event, listener) => {
        emitter.on(event, listener);
        return res;
      }
    };
    return res;
  };

  it('creates a stream for the authenticated user and emits subject values', async () => {
    const subject = new Subject<MessageEvent>();
    service.getOrCreateStream.mockReturnValue(subject);

    const req = buildReq('user-1');
    const res = buildRes();
    // @ts-expect-error partial Response mock
    const stream$ = controller.stream(req, res);

    expect(service.getOrCreateStream).toHaveBeenCalledWith(
      'user-1',
      expect.any(String)
    );

    const received = firstValueFrom(stream$.pipe(take(1)));
    subject.next({ data: 'hello' });
    await expect(received).resolves.toEqual({ data: 'hello' });
  });

  it('closes the stream on response close using the same connectionId', () => {
    const subject = new Subject<MessageEvent>();
    service.getOrCreateStream.mockReturnValue(subject);

    const req = buildReq('user-2');
    const res = buildRes();
    // @ts-expect-error partial Response mock
    controller.stream(req, res);

    const firstCall = service.getOrCreateStream.mock.calls[0] as [
      string,
      string
    ];
    const connectionId = firstCall[1];
    res.emitter.emit('close');

    expect(service.closeStream).toHaveBeenCalledWith('user-2', connectionId);
  });
});
