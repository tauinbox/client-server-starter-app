import type { INestApplication } from '@nestjs/common';
import { AuditService } from '../src/modules/audit/audit.service';

/**
 * Records every audit write of the app, awaited or fire-and-forget, so a test
 * can wait for the writes themselves in place of a fixed time. After
 * `settled()` no write that started before it is still open, so a test can
 * also assert that a row was not written.
 */
export function trackAuditWrites(app: INestApplication): {
  settled(): Promise<void>;
  read<T>(query: () => Promise<T>): Promise<T>;
} {
  const audit = app.get(AuditService);
  const log = audit.log.bind(audit);
  const open = new Set<Promise<void>>();

  audit.log = (...args) => {
    const write = log(...args);

    open.add(write);
    void write.then(
      () => open.delete(write),
      () => open.delete(write)
    );

    return write;
  };

  const settled = async (): Promise<void> => {
    while (open.size > 0) {
      await Promise.allSettled(open);
    }
  };

  return {
    settled,
    /** Runs `query` once every audit write that started before has ended. */
    async read<T>(query: () => Promise<T>): Promise<T> {
      await settled();

      return query();
    }
  };
}
