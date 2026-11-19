import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ThrottledFailureLog } from './redis-client';

/**
 * A worker host that sends the errors of its worker loop to the logger, at
 * most once in each throttle window. With no `error` listener BullMQ writes
 * each one to stderr as a raw multi-line dump: a boot on a full Redis wrote
 * about 9100 of them in 5 seconds.
 */
export abstract class LoggedWorkerHost extends WorkerHost {
  readonly #workerErrors = new ThrottledFailureLog(
    new Logger(this.constructor.name),
    'Queue worker loop failed, no job is taken'
  );

  @OnWorkerEvent('error')
  onWorkerError(error: Error): void {
    this.#workerErrors.log(error);
  }
}
