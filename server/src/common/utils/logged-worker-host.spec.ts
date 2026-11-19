import { Logger } from '@nestjs/common';
import { LoggedWorkerHost } from './logged-worker-host';

class ProbeWorkerHost extends LoggedWorkerHost {
  async process(): Promise<void> {
    // The worker loop is under test, not a job.
  }
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
});
