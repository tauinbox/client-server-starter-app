import { Logger } from '@nestjs/common';
import { createMockCache } from '../testing/cache.mock';
import { CacheVersionCounter } from './cache-version-counter';

describe('CacheVersionCounter without Redis', () => {
  afterEach(() => jest.restoreAllMocks());

  function counter(): CacheVersionCounter {
    return new CacheVersionCounter(
      createMockCache(),
      'test:counter',
      'test:version',
      new Logger('test')
    );
  }

  it('gives concurrent first reads one version across a millisecond boundary', async () => {
    jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1001);
    const versions = counter();

    const reads = await Promise.all([versions.read(), versions.read()]);

    expect(reads).toEqual([1000, 1000]);
    expect(await versions.read()).toBe(1000);
  });

  it('a read after a bump sees the new version', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    const versions = counter();
    await versions.read();

    await versions.bump();

    expect(await versions.read()).toBe(1001);
  });

  it('keeps the counters of two scopes apart', async () => {
    jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    const versions = counter();

    const [a, b] = await Promise.all([
      versions.read('user-a'),
      versions.read('user-b')
    ]);

    expect([a, b]).toEqual([1000, 2000]);
  });
});
