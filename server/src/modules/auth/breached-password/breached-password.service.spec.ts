import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { createHash } from 'crypto';
import { ErrorKeys } from '@app/shared/constants';
import { MetricsService } from '../../core/metrics/metrics.service';
import { BreachedPasswordService } from './breached-password.service';

const RANGE_URL = 'https://blocklist.test/range';

function suffixOf(password: string): string {
  return createHash('sha1')
    .update(password, 'utf8')
    .digest('hex')
    .slice(5)
    .toUpperCase();
}

function prefixOf(password: string): string {
  return createHash('sha1')
    .update(password, 'utf8')
    .digest('hex')
    .slice(0, 5)
    .toUpperCase();
}

/** The four members the service reads off a fetch response. */
type FetchResponseStub = Pick<
  Response,
  'ok' | 'status' | 'statusText' | 'text'
>;

describe('BreachedPasswordService', () => {
  let service: BreachedPasswordService;
  let recordBreachLookup: jest.Mock;
  let fetchMock: jest.Mock;

  const okResponse = (body: string): FetchResponseStub => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: () => Promise.resolve(body)
  });

  beforeEach(async () => {
    recordBreachLookup = jest.fn();
    fetchMock = jest.fn();
    global.fetch = fetchMock;

    const module = await Test.createTestingModule({
      providers: [
        BreachedPasswordService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(RANGE_URL) }
        },
        { provide: MetricsService, useValue: { recordBreachLookup } }
      ]
    }).compile();

    service = module.get(BreachedPasswordService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends only the five-character hash prefix to the blocklist', async () => {
    fetchMock.mockResolvedValue(okResponse(''));

    await service.assertNotBreached('Sunrise-Kettle-19');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${RANGE_URL}/${prefixOf('Sunrise-Kettle-19')}`);
    expect(url).not.toContain(suffixOf('Sunrise-Kettle-19'));
  });

  it('refuses a listed password with the shared error key', async () => {
    const password = 'Sunrise-Kettle-19';
    fetchMock.mockResolvedValue(okResponse(`${suffixOf(password)}:42\r\n`));

    await expect(service.assertNotBreached(password)).rejects.toMatchObject({
      status: 400,
      response: { errorKey: ErrorKeys.AUTH.PASSWORD_BREACHED }
    });
    expect(recordBreachLookup).toHaveBeenCalledWith('breached');
  });

  it('accepts a password the response does not list', async () => {
    fetchMock.mockResolvedValue(
      okResponse('0000000000000000000000000000000000A:9\r\n')
    );

    await expect(
      service.assertNotBreached('Sunrise-Kettle-19')
    ).resolves.toBeUndefined();
    expect(recordBreachLookup).toHaveBeenCalledWith('clean');
  });

  it('treats a padded zero-count entry as absent', async () => {
    // `Add-Padding` mixes in decoys with a count of zero. Matching one would
    // refuse an arbitrary clean password.
    const password = 'Sunrise-Kettle-19';
    fetchMock.mockResolvedValue(okResponse(`${suffixOf(password)}:0\r\n`));

    await expect(service.assertNotBreached(password)).resolves.toBeUndefined();
    expect(recordBreachLookup).toHaveBeenCalledWith('clean');
  });

  describe('fail open', () => {
    it('accepts the password when the lookup throws, and counts it', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      await expect(
        service.assertNotBreached('Sunrise-Kettle-19')
      ).resolves.toBeUndefined();
      expect(recordBreachLookup).toHaveBeenCalledWith('unavailable');
    });

    it('accepts the password on a non-OK status, and counts it', async () => {
      const failed: FetchResponseStub = {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: () => Promise.resolve('')
      };
      fetchMock.mockResolvedValue(failed);

      await expect(
        service.assertNotBreached('Sunrise-Kettle-19')
      ).resolves.toBeUndefined();
      expect(recordBreachLookup).toHaveBeenCalledWith('unavailable');
    });

    it('abandons a lookup that does not answer', async () => {
      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        expect(init.signal).toBeInstanceOf(AbortSignal);
        return Promise.reject(new DOMException('timed out', 'TimeoutError'));
      });

      await expect(
        service.assertNotBreached('Sunrise-Kettle-19')
      ).resolves.toBeUndefined();
      expect(recordBreachLookup).toHaveBeenCalledWith('unavailable');
    });
  });

  it('accepts a password made only of lower-case letters', async () => {
    // The composition rules this check replaced refused it outright.
    fetchMock.mockResolvedValue(okResponse(''));

    await expect(
      service.assertNotBreached('kettlesunrise')
    ).resolves.toBeUndefined();
  });

  it('throws an HttpException, so the exception filter shapes the body', async () => {
    const password = 'Sunrise-Kettle-19';
    fetchMock.mockResolvedValue(okResponse(`${suffixOf(password)}:1\r\n`));

    await expect(service.assertNotBreached(password)).rejects.toBeInstanceOf(
      HttpException
    );
  });
});
