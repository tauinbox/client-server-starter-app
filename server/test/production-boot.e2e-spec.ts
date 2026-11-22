import { LISTENING, spawnServer, stopServer } from './server-process';
import { waitUntil } from './eventually';

const runWithDb = process.env['DB_HOST'] ? describe : describe.skip;

runWithDb('production boot (e2e)', () => {
  it('exits with an error before it listens when REDIS_URL is empty', async () => {
    const server = await spawnServer({ REDIS_URL: '' });

    try {
      const code = await waitUntil(
        'the production process without Redis exits',
        () => Promise.resolve(server.process.exitCode),
        { timeoutMs: 60000, intervalMs: 100 }
      );

      expect(code).toBe(1);
      expect(server.output()).toContain('REDIS_URL is not set');
      expect(server.output()).not.toContain(LISTENING);
    } finally {
      await stopServer(server);
    }
  }, 90000);
});
