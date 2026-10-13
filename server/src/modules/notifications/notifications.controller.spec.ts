import { EventEmitter } from 'events';
import { of } from 'rxjs';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import type { JwtAuthRequest } from '../auth/types/auth.request';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: Pick<NotificationsService, 'openStream' | 'closeStream'> & {
    openStream: jest.Mock;
    closeStream: jest.Mock;
  };

  beforeEach(() => {
    service = {
      openStream: jest.fn().mockReturnValue(of({ data: 'hello' })),
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
        roles: [],
        sessionId: `session-of-${userId}`
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

  it('opens the stream for the user and the session of the caller', () => {
    const req = buildReq('user-1');
    const res = buildRes();
    // @ts-expect-error partial Response mock
    const stream$ = controller.stream(req, res);

    expect(service.openStream).toHaveBeenCalledWith(
      'user-1',
      'session-of-user-1',
      expect.any(String)
    );
    expect(stream$).toBe(service.openStream.mock.results[0]?.value);
  });

  it('closes the stream on response close using the same connectionId', () => {
    const req = buildReq('user-2');
    const res = buildRes();
    // @ts-expect-error partial Response mock
    controller.stream(req, res);

    const firstCall = service.openStream.mock.calls[0] as [
      string,
      string,
      string
    ];
    const connectionId = firstCall[2];
    res.emitter.emit('close');

    expect(service.closeStream).toHaveBeenCalledWith('user-2', connectionId);
  });
});
