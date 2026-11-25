/**
 * A fake `DataSource` whose transactions and query runners all run on
 * `manager`, for a unit spec of a service that writes through `inBothSources`
 * or `writeSettings`. `transaction` is a mock, so a spec can count or fail the
 * transactions; `runners` lists each query runner that was created.
 */
export function dataSourceDouble<M extends object>(manager: M) {
  const runners: Array<{
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
  }> = [];

  return {
    manager,
    runners,
    transaction: jest.fn((run: (em: M) => Promise<unknown>) => run(manager)),
    createQueryRunner: jest.fn(() => {
      const runner = {
        manager,
        isTransactionActive: false,
        connect: jest.fn(() => Promise.resolve()),
        startTransaction: jest.fn(() => {
          runner.isTransactionActive = true;

          return Promise.resolve();
        }),
        commitTransaction: jest.fn(() => {
          runner.isTransactionActive = false;

          return Promise.resolve();
        }),
        rollbackTransaction: jest.fn(() => {
          runner.isTransactionActive = false;

          return Promise.resolve();
        }),
        release: jest.fn(() => Promise.resolve())
      };

      runners.push(runner);

      return runner;
    })
  };
}
