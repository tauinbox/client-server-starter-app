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

/**
 * Like `eventually`, but throws when the time runs out. Use it when the test
 * does not branch on the result: the error names the link that never came,
 * where a later assertion on an empty value cannot.
 */
export async function waitUntil<T>(
  link: string,
  read: () => Promise<T | null>,
  { timeoutMs = 5000, intervalMs = 50 } = {}
): Promise<T> {
  const value = await eventually(read, timeoutMs, intervalMs);

  if (value === null) {
    throw new Error(`Timed out after ${timeoutMs} ms: ${link}`);
  }

  return value;
}
