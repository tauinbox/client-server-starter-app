import { httpStatusText } from '@app/shared/constants';

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Reads an error answer, checks the envelope fields that every error carries
 * (`error`, `timestamp`, `path`) and returns the rest for an exact comparison.
 */
export async function readErrorBody(
  res: Response
): Promise<Record<string, unknown>> {
  const { error, timestamp, path, ...rest } = (await res.json()) as Record<
    string,
    unknown
  >;
  const url = new URL(res.url);
  const problems = [
    error !== httpStatusText(res.status) && `error is ${String(error)}`,
    !(typeof timestamp === 'string' && ISO_TIMESTAMP.test(timestamp)) &&
      `timestamp is ${String(timestamp)}`,
    path !== url.pathname + url.search && `path is ${String(path)}`
  ].filter(Boolean);
  if (problems.length > 0) {
    throw new Error(`Bad error envelope: ${problems.join(', ')}`);
  }
  return rest;
}
