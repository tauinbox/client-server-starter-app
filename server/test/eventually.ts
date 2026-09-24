/**
 * Re-reads until the value exists or the time runs out. For a row written with
 * `logFireAndForget`: the response can reach the test before that insert
 * commits, so one immediate read loses the race now and then.
 */
export async function eventually<T>(
  read: () => Promise<T | null>,
  timeoutMs = 5000,
  intervalMs = 50
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== null || Date.now() >= deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
