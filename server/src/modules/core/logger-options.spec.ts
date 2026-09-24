import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AxiosError, AxiosHeaders } from 'axios';
import { LoggerModule, Logger as PinoNestLogger } from 'nestjs-pino';
import { __resetOutOfContextForTests } from 'nestjs-pino/PinoLogger';
import { pinoHttp } from 'pino-http';
import type { Options } from 'pino-http';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { Writable } from 'stream';
import { QueryFailedError } from 'typeorm';
import { buildLoggerOptions, maskEmailsInText } from './logger-options';

const ADDRESS = 'alice.private@example.com';
const MASKED = 'a***e@example.com';

interface LogLine {
  level: number;
  msg?: string;
  context?: string;
  err?: Record<string, unknown>;
  req?: Record<string, unknown>;
}

function collect(lines: LogLine[]): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as LogLine);
      callback();
    }
  });
}

function productionOptions(): Options {
  return buildLoggerOptions('production').pinoHttp as Options;
}

// Outside a request, nestjs-pino logs through a plain pino instance.
async function captureLogs(): Promise<LogLine[]> {
  const lines: LogLine[] = [];
  const stream = collect(lines);
  const options = productionOptions();

  __resetOutOfContextForTests();
  const moduleRef = await Test.createTestingModule({
    imports: [LoggerModule.forRoot({ pinoHttp: [options, stream] })]
  }).compile();
  moduleRef.useLogger(moduleRef.get(PinoNestLogger));
  return lines;
}

function buildQueryFailedError(): QueryFailedError {
  const driverError = Object.assign(
    new Error('duplicate key value violates unique constraint'),
    { code: '23505', detail: `Key (email)=(${ADDRESS}) already exists.` }
  );
  return new QueryFailedError(
    'INSERT INTO "users" ("email", "password") VALUES ($1, $2)',
    [ADDRESS, 'hash-SECRET'],
    driverError
  );
}

function buildAxiosError(): AxiosError {
  return new AxiosError(
    'Request failed with status code 401',
    'ERR_BAD_REQUEST',
    {
      headers: new AxiosHeaders({ Authorization: 'Basic c2hvcDpTRUNSRVQ=' }),
      auth: { username: 'shop', password: 'live_SECRET' },
      data: JSON.stringify({ receipt: { email: ADDRESS } })
    }
  );
}

function buildSmtpRejection(): Error {
  const reply = `550 5.1.1 <${ADDRESS}>: Recipient address rejected`;
  return Object.assign(
    new Error(`Can't send mail - all recipients were rejected: ${reply}`),
    {
      code: 'EENVELOPE',
      response: reply,
      responseCode: 550,
      command: 'RCPT TO',
      rejected: [ADDRESS]
    }
  );
}

describe('buildLoggerOptions', () => {
  let lines: LogLine[];

  beforeEach(async () => {
    lines = await captureLogs();
  });

  it('writes an Error passed after the message as err, with its stack', () => {
    new Logger('Probe').error('Job failed', new Error('boom'));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 50,
      context: 'Probe',
      msg: 'Job failed',
      err: { type: 'Error', message: 'boom' }
    });
    expect(lines[0].err?.['stack']).toContain('logger-options.spec.ts');
  });

  it('writes the Error on a warn line too', () => {
    new Logger('Probe').warn('Degraded', new Error('slow'));

    expect(lines[0]).toMatchObject({
      level: 40,
      msg: 'Degraded',
      err: { message: 'slow' }
    });
  });

  it('keeps a line without an Error as it was', () => {
    new Logger('Probe').error('Plain failure');

    expect(lines[0].msg).toBe('Plain failure');
    expect(lines[0].err).toBeUndefined();
  });

  it.each([
    ['QueryFailedError', buildQueryFailedError, '23505'],
    ['AxiosError', buildAxiosError, 'ERR_BAD_REQUEST'],
    ['SMTP rejection', buildSmtpRejection, 'EENVELOPE']
  ])(
    'writes only the allowlisted fields of a %s',
    (_name, build: () => Error, code) => {
      new Logger('Probe').error('Operation failed', build());

      const written = JSON.stringify(lines[0]);
      expect(Object.keys(lines[0].err ?? {}).sort()).toEqual([
        'code',
        'message',
        'stack',
        'type'
      ]);
      expect(lines[0].err?.['code']).toBe(code);
      expect(written).not.toContain(ADDRESS);
      expect(written).not.toContain('SECRET');
      expect(written).not.toContain('c2hvcDpTRUNSRVQ');
      expect(written).not.toContain('parameters');
      expect(written).not.toContain('config');
    }
  );

  it('masks an address in the message and the stack of the error', () => {
    new Logger('Probe').error('Mail failed', buildSmtpRejection());

    expect(lines[0].err?.['message']).toContain(`<${MASKED}>`);
    expect(lines[0].err?.['stack']).toContain(`<${MASKED}>`);
  });

  it('masks an address in a stack string passed by an exception handler', () => {
    const error = buildSmtpRejection();
    new Logger('Probe').error('Unhandled', error.stack);

    expect(lines[0].err?.['stack']).toContain(`<${MASKED}>`);
    expect(JSON.stringify(lines[0])).not.toContain(ADDRESS);
  });
});

// Inside a request, nestjs-pino logs through the pino-http child logger, whose
// serializers pino-http wraps with the standard ones.
describe('buildLoggerOptions inside a request', () => {
  it('writes only the allowlisted fields and keeps the error type', () => {
    const lines: LogLine[] = [];
    const { logger } = pinoHttp(productionOptions(), collect(lines));

    logger.error({ err: buildQueryFailedError() }, 'Operation failed');

    expect(Object.keys(lines[0].err ?? {}).sort()).toEqual([
      'code',
      'message',
      'stack',
      'type'
    ]);
    expect(lines[0].err?.['type']).toBe('QueryFailedError');
    expect(JSON.stringify(lines[0])).not.toContain(ADDRESS);
  });

  it('writes only the allowlisted request fields and redacts the OAuth code', () => {
    const lines: LogLine[] = [];
    const middleware = pinoHttp(productionOptions(), collect(lines));
    const req = new IncomingMessage(new Socket());
    req.method = 'GET';
    req.url = '/api/v1/auth/google/callback?code=OAUTHCODE&state=OAUTHSTATE';
    req.headers = {
      authorization: 'Bearer ACCESS-SECRET',
      cookie: '__Host-refresh_token=REFRESH-SECRET',
      'user-agent': 'Probe-UA',
      'x-request-id': 'rid-1'
    };
    middleware(req, new ServerResponse(req));

    req.log.warn('Callback failed');

    const written = JSON.stringify(lines[0]);
    for (const secret of [
      'ACCESS-SECRET',
      'REFRESH-SECRET',
      'OAUTHCODE',
      'OAUTHSTATE'
    ]) {
      expect(written).not.toContain(secret);
    }
    expect(Object.keys(lines[0].req ?? {}).sort()).toEqual([
      'headers',
      'id',
      'method',
      'url'
    ]);
    expect(lines[0].req).toMatchObject({
      method: 'GET',
      url: '/api/v1/auth/google/callback?code=REDACTED&state=REDACTED'
    });
    expect(lines[0].req?.['headers']).toEqual({
      'user-agent': 'Probe-UA',
      'x-request-id': 'rid-1'
    });
  });
});

describe('maskEmailsInText', () => {
  it('masks every address in the text', () => {
    expect(maskEmailsInText(`to ${ADDRESS}, cc bob@mail.example.org`)).toBe(
      `to ${MASKED}, cc b***b@mail.example.org`
    );
  });

  it('leaves scoped package paths and versioned names in a stack intact', () => {
    const frames = [
      'at run (/app/node_modules/@nestjs/core/router/router-proxy.js:9:23)',
      'at load (/app/node_modules/.pnpm/typeorm@0.3.31/node_modules/x.js:1:1)'
    ].join('\n');

    expect(maskEmailsInText(frames)).toBe(frames);
  });
});
