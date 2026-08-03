import * as http from 'http';
import type { Server } from 'http';
import { createApp } from '../app';
import {
  baseUrlOf,
  isBlockedPort,
  listenOnUnblockedPort,
  portOf,
  type PortBinder
} from '../utils/listen';

// Reports a scripted port from address() while the socket keeps its real
// ephemeral port, so the blocked branch is exercised without depending on a
// blocked port being free on the host.
function reportingPort(server: Server, port: number): Server {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === 'address') {
        return () => ({ address: '127.0.0.1', family: 'IPv4', port });
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function binderYielding(candidates: (number | null)[]): {
  binder: PortBinder;
  created: Server[];
} {
  const queue = [...candidates];
  const created: Server[] = [];

  const binder: PortBinder = {
    listen(port, callback) {
      const real = http.createServer();
      created.push(real);
      const scripted = queue.length > 0 ? queue.shift() : null;
      const server = real.listen(port, callback);
      return scripted == null ? server : reportingPort(server, scripted);
    }
  };

  return { binder, created };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('listenOnUnblockedPort', () => {
  // The three ports below were checked against fetch itself: 6679 and 10080
  // fail with "bad port", 6680 answers 200.
  it('classifies the ports fetch refuses', () => {
    expect(isBlockedPort(6679)).toBe(true);
    expect(isBlockedPort(10080)).toBe(true);
    expect(isBlockedPort(6680)).toBe(false);
  });

  it('retries past blocked ports and resolves with a usable one', async () => {
    const { binder, created } = binderYielding([6679, 10080, null]);

    const server = await listenOnUnblockedPort(binder);

    expect(isBlockedPort(portOf(server))).toBe(false);
    expect(portOf(server)).toBeGreaterThan(0);
    expect(created).toHaveLength(3);
    expect(created[0].listening).toBe(false);
    expect(created[1].listening).toBe(false);

    await close(server);
  });

  it('stays bound to the blocked port while retrying', async () => {
    const { binder, created } = binderYielding([6679, null]);

    const heldDuringRetry: boolean[] = [];
    const listen = binder.listen.bind(binder);
    binder.listen = (port, callback) => {
      heldDuringRetry.push(created.every((server) => server.listening));
      return listen(port, callback);
    };

    const server = await listenOnUnblockedPort(binder);

    expect(heldDuringRetry[1]).toBe(true);
    await close(server);
  });

  it('gives up after maxAttempts and releases the sockets it held', async () => {
    const { binder, created } = binderYielding([6679, 6679, 6679, 6679]);

    await expect(listenOnUnblockedPort(binder, 3)).rejects.toThrow(
      'Could not bind an unblocked ephemeral port after 3 attempts'
    );

    expect(created).toHaveLength(3);
    expect(created.every((server) => server.listening)).toBe(false);
  });

  it('binds the mock server on a port fetch accepts', async () => {
    const server = await listenOnUnblockedPort(createApp());

    const response = await fetch(`${baseUrlOf(server)}/api/v1/users`);

    expect(response.status).toBe(401);
    await close(server);
  });
});
