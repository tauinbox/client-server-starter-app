import { type ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { get, type IncomingMessage } from 'http';
import { createServer, type AddressInfo } from 'net';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { DataSource, In } from 'typeorm';
import {
  ErrorKeys,
  REAUTH_PROOF_MAX_AGE_SECONDS,
  STEP_UP_OPERATION,
  SYSTEM_ROLES,
  TOKEN_PURPOSE
} from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { PurposeTokenService } from '../src/modules/auth/services/purpose-token.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { REAUTH_PROOF_COOKIE } from '../src/modules/auth/constants/oauth.constants';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { cookieName } from '../src/common/utils/host-cookie';
import { waitUntil } from './eventually';

const { REDIS_URL } = process.env;
const MAIN = join(__dirname, '..', 'dist', 'server', 'src', 'main.js');

// Two processes of the built server on one Postgres and one Redis, as two nodes
// of one pool. A request on node A and the next one on node B is the worst case
// of a round-robin load balancer, so no proxy sits in front of them.
const runWithRedis =
  REDIS_URL && process.env['DB_HOST'] ? describe : describe.skip;

interface Node {
  name: string;
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

async function startNode(name: string): Promise<Node> {
  const port = await freePort();
  // NODE_ENV=test selects the in-process SSE bus; a node needs the Redis one.
  const { NODE_ENV: _nodeEnv, ...env } = process.env;
  const child = spawn(process.execPath, [MAIN], {
    cwd: join(__dirname, '..'),
    env: {
      ...env,
      ENVIRONMENT: 'production',
      APPLICATION_PORT: String(port),
      // Each test sends its own client address, so its rate limits are its own.
      TRUSTED_PROXIES: 'loopback'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';

  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

  await waitUntil(
    `node ${name} listens on port ${port}`,
    () => {
      if (child.exitCode !== null) {
        throw new Error(
          `node ${name} exited with ${child.exitCode}:\n${output}`
        );
      }

      return Promise.resolve(
        output.includes('Server started listening') || null
      );
    },
    { timeoutMs: 60000, intervalMs: 100 }
  );

  return { name, port, process: child, output: () => output };
}

function stopNode(node: Node | undefined): Promise<void> {
  if (!node || node.process.exitCode !== null) return Promise.resolve();

  return new Promise((resolve) => {
    node.process.once('exit', () => resolve());
    node.process.kill();
  });
}

runWithRedis('two nodes of one pool (e2e)', () => {
  const tag = `two-node-${Date.now()}`;
  const emails = {
    viewer: `${tag}-viewer@example.com`,
    prover: `${tag}-prover@example.com`
  };
  const roleName = `${tag}-viewer`;

  let context: INestApplication;
  let redis: Redis;
  let nodeA: Node;
  let nodeB: Node;
  let viewer: User;
  let prover: User;
  const streams: { destroy: () => void }[] = [];

  beforeAll(async () => {
    if (!existsSync(MAIN)) {
      throw new Error(`${MAIN} does not exist: run npm run build first`);
    }

    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    context = moduleRef.createNestApplication();
    await context.init();
    redis = new Redis(REDIS_URL ?? '');

    const dataSource = context.get(DataSource);
    const users = dataSource.getRepository(User);
    const saveUser = (email: string) =>
      users.save(
        users.create({
          email,
          name: 'Two Node',
          isEmailVerified: true,
          password: null
        })
      );

    viewer = await saveUser(emails.viewer);
    prover = await saveUser(emails.prover);

    const roleService = context.get(RoleService);
    const userRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ name: SYSTEM_ROLES.USER });
    const searchUser = await dataSource.getRepository(Permission).findOne({
      where: { action: { name: 'search' }, resource: { subject: 'User' } },
      relations: { action: true, resource: true }
    });

    if (!searchUser) throw new Error('Permission search:User missing');

    const viewerRole = await roleService.create(
      { name: roleName },
      { ability: SYSTEM_ABILITY }
    );

    await roleService.setPermissionsForRole(
      viewerRole.id,
      [{ permissionId: searchUser.id }],
      { ability: SYSTEM_ABILITY }
    );

    for (const roleId of [userRole.id, viewerRole.id]) {
      await roleService.assignRoleToUser(viewer.id, roleId, {
        ability: SYSTEM_ABILITY
      });
    }

    await roleService.assignRoleToUser(prover.id, userRole.id, {
      ability: SYSTEM_ABILITY
    });

    [nodeA, nodeB] = await Promise.all([startNode('A'), startNode('B')]);
  }, 120000);

  afterAll(async () => {
    for (const stream of streams) stream.destroy();

    await Promise.all([stopNode(nodeA), stopNode(nodeB)]);

    if (context) {
      const dataSource = context.get(DataSource);

      await dataSource.getRepository(Role).delete({ name: roleName });
      await dataSource
        .getRepository(User)
        .delete({ email: In(Object.values(emails)) });
    }

    await context?.close();
    await redis?.quit();
  });

  async function accessTokenOf(user: User): Promise<string> {
    const { tokens } = await context
      .get(AuthService)
      .login(await context.get(UsersService).findOne(user.id, SYSTEM_ABILITY), {
        userAgent: 'two-node-e2e',
        ipAddress: '203.0.113.40'
      });

    return tokens.access_token;
  }

  function call(
    node: Node,
    path: string,
    {
      method,
      headers = {},
      body
    }: {
      method: string;
      headers?: Record<string, string>;
      body?: unknown;
    }
  ): Promise<Response> {
    return fetch(`http://127.0.0.1:${node.port}/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  }

  it('refuses on node B a step-up proof that node A spent', async () => {
    const accessToken = await accessTokenOf(prover);
    const proof = context.get(PurposeTokenService).sign(
      {
        sub: prover.id,
        operation: STEP_UP_OPERATION.SESSION_REVOKE,
        jti: randomUUID()
      },
      {
        purpose: TOKEN_PURPOSE.REAUTH_PROOF,
        expiresIn: REAUTH_PROOF_MAX_AGE_SECONDS
      }
    );
    const revokeOthers = (node: Node) =>
      call(node, '/auth/sessions', {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${accessToken}`,
          cookie: `${cookieName(REAUTH_PROOF_COOKIE, true)}=${proof}`,
          'x-forwarded-for': '203.0.113.41'
        },
        body: {}
      });

    const first = await revokeOthers(nodeA);

    expect(first.status).toBe(200);

    const second = await revokeOthers(nodeB);

    expect(second.status).toBe(403);
    expect(await second.json()).toEqual(
      expect.objectContaining({ errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED })
    );
  });

  it('counts the sign-in attempts of both nodes against one limit', async () => {
    // The login route allows 3 attempts a minute from one address. Each node
    // alone sees 2 of the first 4, so only a shared count refuses the fourth.
    const attempt = (node: Node) =>
      call(node, '/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.42' },
        body: { email: `${tag}-nobody@example.com`, password: 'Wrong-pass-42' }
      });

    const statuses: number[] = [];

    for (const node of [nodeA, nodeB, nodeA, nodeB]) {
      statuses.push((await attempt(node)).status);
    }

    expect(statuses).toEqual([401, 401, 401, 429]);
  });

  it('delivers to a stream on node B the push that a request on node A raises', async () => {
    const accessToken = await accessTokenOf(viewer);
    let body = '';

    await new Promise<void>((resolve, reject) => {
      const req = get(
        {
          host: '127.0.0.1',
          port: nodeB.port,
          path: '/api/v1/notifications/stream',
          headers: { authorization: `Bearer ${accessToken}` }
        },
        (res: IncomingMessage) => {
          if (res.statusCode !== 200) {
            reject(new Error(`stream status ${res.statusCode}`));

            return;
          }

          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (body += chunk));
          res.on('error', () => undefined);
          resolve();
        }
      );

      req.on('error', () => undefined);
      streams.push(req);
    });

    // Node A finds the recipients in the shared registry, so the stream on
    // node B must be in it before node A raises the push.
    await waitUntil('the registry holds the stream on node B', async () => {
      const members = await redis.zrange('nexus:sse:users', 0, -1);

      return members.some((member) => member.endsWith(viewer.id)) || null;
    });

    const renamed = await call(nodeA, '/auth/profile', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${accessToken}` },
      body: { name: 'Two Node Renamed' }
    });

    expect(renamed.status).toBe(200);

    await waitUntil('node B delivers the push of node A', () =>
      Promise.resolve(
        body
          .split('\n')
          .filter((line) => line.startsWith('data: {'))
          .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)
          .find(
            (event) =>
              event['type'] === 'user_crud_events' &&
              event['userId'] === viewer.id
          ) ?? null
      )
    );
  });
});
