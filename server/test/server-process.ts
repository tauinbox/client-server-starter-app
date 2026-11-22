import { type ChildProcess, spawn } from 'child_process';
import { existsSync } from 'fs';
import { createServer, type AddressInfo } from 'net';
import { join } from 'path';

const MAIN = join(__dirname, '..', 'dist', 'server', 'src', 'main.js');

export interface ServerProcess {
  port: number;
  process: ChildProcess;
  output: () => string;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;

      server.close(() => resolve(port));
    });
  });
}

/**
 * Starts `main.ts` of the built server as its own process, in production mode,
 * with the environment of the test run and the given overrides.
 */
export async function spawnServer(
  overrides: Record<string, string> = {}
): Promise<ServerProcess> {
  if (!existsSync(MAIN)) {
    throw new Error(`${MAIN} does not exist: run npm run build first`);
  }

  const port = await freePort();
  // NODE_ENV=test selects the in-process SSE bus; a node needs the Redis one.
  const { NODE_ENV: _nodeEnv, ...env } = process.env;
  const child = spawn(process.execPath, [MAIN], {
    cwd: join(__dirname, '..'),
    env: {
      ...env,
      ENVIRONMENT: 'production',
      APPLICATION_PORT: String(port),
      ...overrides
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';

  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

  return { port, process: child, output: () => output };
}

export const LISTENING = 'Server started listening';

export function stopServer(server: ServerProcess | undefined): Promise<void> {
  if (!server || server.process.exitCode !== null) return Promise.resolve();

  return new Promise((resolve) => {
    server.process.once('exit', () => resolve());
    server.process.kill();
  });
}
