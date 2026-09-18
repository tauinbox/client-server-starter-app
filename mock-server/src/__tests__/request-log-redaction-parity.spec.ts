import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';

// Mirrors RequestLoggingMiddleware on the server: the OAuth callback carries
// the authorization code and the state in its query string, and the request
// log line must store neither.

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = await listenOnUnblockedPort(createApp());
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

it('writes the callback URL to the request log without the code or the state', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await fetch(
      `${baseUrl}/api/v1/auth/oauth/google/callback?state=s3cr3t-state&code=s3cr3t-code`
    );
    // The line is written on `finish`, which can land after the client has
    // read the response.
    await new Promise((resolve) => setImmediate(resolve));

    const lines = log.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.startsWith('[HTTP]'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(
      '/api/v1/auth/oauth/google/callback?state=REDACTED&code=REDACTED'
    );
    expect(lines[0]).not.toContain('s3cr3t');
  } finally {
    log.mockRestore();
  }
});
