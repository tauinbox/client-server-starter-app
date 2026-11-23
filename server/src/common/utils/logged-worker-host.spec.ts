import { Logger } from '@nestjs/common';
import { DelayedError, type Job } from 'bullmq';
import {
  LoggedWorkerHost,
  NEWER_FORMAT_RETRY_DELAY_MS
} from './logged-worker-host';

class ProbeWorkerHost extends LoggedWorkerHost {
  async process(job: Job<object>, token?: string): Promise<void> {
    await this.deferNewerFormat(job, token, 1);
  }
}

function probeJob(data: object): {
  job: Job<object>;
  moveToDelayed: jest.Mock;
} {
  const moveToDelayed = jest.fn().mockResolvedValue(undefined);
  const stub: Pick<Job<object>, 'data' | 'moveToDelayed'> = {
    data,
    moveToDelayed
  };

  // @ts-expect-error minimal Job stub: deferNewerFormat reads only these two
  const job: Job<object> = stub;

  return { job, moveToDelayed };
}

describe('LoggedWorkerHost', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The metadata key of @nestjs/bullmq is not exported, so the test looks for
  // the value that `@OnWorkerEvent('error')` writes.
  it('listens to the error event of the worker', () => {
    const handler = LoggedWorkerHost.prototype.onWorkerError;
    const metadata = Reflect.getMetadataKeys(handler).map((key): unknown =>
      Reflect.getMetadata(key, handler)
    );

    expect(metadata).toContainEqual({ eventName: 'error' });
  });

  // A boot on a full Redis fails the loop thousands of times in seconds.
  it('logs the first error of a window and drops the rest', () => {
    const host = new ProbeWorkerHost();

    host.onWorkerError(new Error('OOM command not allowed'));
    host.onWorkerError(new Error('OOM command not allowed'));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Queue worker loop failed, no job is taken: OOM command not allowed'
    );
  });

  describe('deferNewerFormat', () => {
    it('delays a job of a newer format with the lock token and throws DelayedError', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      const { job, moveToDelayed } = probeJob({ format: 2 });

      await expect(
        new ProbeWorkerHost().process(job, 'lock-1')
      ).rejects.toBeInstanceOf(DelayedError);
      expect(moveToDelayed).toHaveBeenCalledWith(
        1_000_000 + NEWER_FORMAT_RETRY_DELAY_MS,
        'lock-1'
      );
    });

    it.each([
      ['a job with no format (queued before the formats)', {}],
      ['a job of the known format', { format: 1 }]
    ])('runs %s', async (_title, data) => {
      const { job, moveToDelayed } = probeJob(data);

      await expect(
        new ProbeWorkerHost().process(job, 'lock-1')
      ).resolves.toBeUndefined();
      expect(moveToDelayed).not.toHaveBeenCalled();
    });
  });
});
