/**
 * A DataSource stub for `runOncePerPool` and `runSerializedInPool`: the
 * transaction runs at once, and the advisory lock query answers `locked`.
 */
export function poolLockDataSource(locked = true) {
  const query = jest.fn().mockResolvedValue([{ locked }]);

  return {
    query,
    transaction: jest.fn(
      (work: (manager: { query: jest.Mock }) => Promise<unknown>) =>
        work({ query })
    )
  };
}
