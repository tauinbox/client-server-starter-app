import type { Server } from 'http';

// WHATWG bad ports: undici rejects requests to them with "bad port" and
// Chromium with ERR_UNSAFE_PORT, so a listen(0) bind that lands on one is
// unreachable from both the specs and the browser.
const BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080
]);

const DEFAULT_MAX_ATTEMPTS = 10;

// Narrow enough that tests can drive the retry path with their own ports.
export interface PortBinder {
  listen(port: number, callback: () => void): Server;
}

export function isBlockedPort(port: number): boolean {
  return BLOCKED_PORTS.has(port);
}

export function portOf(server: Server): number {
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

export function baseUrlOf(server: Server): string {
  return `http://localhost:${portOf(server)}`;
}

export function listenOnUnblockedPort(
  app: PortBinder,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS
): Promise<Server> {
  return new Promise<Server>((resolve, reject) => {
    const held: Server[] = [];
    const releaseHeld = (): void => held.forEach((server) => server.close());

    const attempt = (): void => {
      const server = app.listen(0, () => {
        if (!isBlockedPort(portOf(server))) {
          releaseHeld();
          resolve(server);
          return;
        }

        // Stay bound to the blocked port so the OS cannot hand the same one
        // back on the retry; released once a usable port is found.
        held.push(server);

        if (held.length >= maxAttempts) {
          releaseHeld();
          reject(
            new Error(
              `Could not bind an unblocked ephemeral port after ${maxAttempts} attempts`
            )
          );
          return;
        }

        attempt();
      });

      server.on('error', (error: Error) => {
        releaseHeld();
        reject(error);
      });
    };

    attempt();
  });
}
