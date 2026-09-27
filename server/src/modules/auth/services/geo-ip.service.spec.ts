import { readFile } from 'fs/promises';
import { Reader } from 'maxmind';
import { GEOIP_IDLE_RELEASE_MS, GeoIpService } from './geo-ip.service';

jest.mock('fs/promises', () => ({ readFile: jest.fn() }));
jest.mock('maxmind', () => ({ Reader: jest.fn() }));

const readFileMock = jest.mocked(readFile);
const ReaderMock = jest.mocked(Reader);

function createService(path: string | undefined): GeoIpService {
  const config = { get: jest.fn().mockReturnValue(path) };
  // @ts-expect-error a partial ConfigService is enough for this service
  return new GeoIpService(config);
}

describe('GeoIpService', () => {
  const get = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    readFileMock.mockReset().mockResolvedValue(Buffer.from('db'));
    ReaderMock.mockReset().mockImplementation(
      // @ts-expect-error the reader double implements only `get`
      () => ({ get })
    );
    get.mockReset().mockReturnValue({
      country: { iso_code: 'DE' },
      city: { names: { en: 'Berlin' } }
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves the country code and the English city name', async () => {
    const service = createService('/geo.mmdb');

    await expect(service.lookup('203.0.113.7')).resolves.toEqual({
      countryCode: 'DE',
      city: 'Berlin'
    });
    expect(readFileMock).toHaveBeenCalledWith('/geo.mmdb');
  });

  it('reads no file when no database is configured', async () => {
    const service = createService(undefined);

    await expect(service.lookup('203.0.113.7')).resolves.toEqual({
      countryCode: null,
      city: null
    });
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it.each([null, '', 'not-an-ip'])(
    'resolves nothing for the address %p',
    async (ip) => {
      const service = createService('/geo.mmdb');

      await expect(service.lookup(ip)).resolves.toEqual({
        countryCode: null,
        city: null
      });
      expect(readFileMock).not.toHaveBeenCalled();
    }
  );

  it('resolves nothing for an address the database does not know', async () => {
    get.mockReturnValue(null);
    const service = createService('/geo.mmdb');

    await expect(service.lookup('10.0.0.1')).resolves.toEqual({
      countryCode: null,
      city: null
    });
  });

  it('resolves nothing when the file cannot be read, and tries again later', async () => {
    readFileMock.mockRejectedValueOnce(new Error('ENOENT'));
    const service = createService('/geo.mmdb');

    await expect(service.lookup('203.0.113.7')).resolves.toEqual({
      countryCode: null,
      city: null
    });
    await expect(service.lookup('203.0.113.7')).resolves.toEqual({
      countryCode: 'DE',
      city: 'Berlin'
    });
    expect(readFileMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the database while lookups continue and releases it after the idle period', async () => {
    const service = createService('/geo.mmdb');

    await service.lookup('203.0.113.7');
    jest.advanceTimersByTime(GEOIP_IDLE_RELEASE_MS - 1);
    await service.lookup('203.0.113.8');
    expect(readFileMock).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(GEOIP_IDLE_RELEASE_MS);
    await service.lookup('203.0.113.9');
    expect(readFileMock).toHaveBeenCalledTimes(2);
  });
});
