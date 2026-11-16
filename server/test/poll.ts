const POLL_DEADLINE_MS = 5000;
const POLL_INTERVAL_MS = 20;

/**
 * True once `condition` holds, false when the deadline passes first. The
 * deadline is a time, not a number of polls, so a slow run gets the same budget
 * as a fast one; it only stops a hang.
 */
export async function pollUntil(
  condition: () => boolean | Promise<boolean>
): Promise<boolean> {
  const deadline = Date.now() + POLL_DEADLINE_MS;

  while (Date.now() < deadline) {
    if (await condition()) return true;

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return condition();
}
