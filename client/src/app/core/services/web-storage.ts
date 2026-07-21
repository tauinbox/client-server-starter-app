/**
 * Type guard narrowing an unvalidated storage value to `T`. Pass one to
 * {@link readStorageValue} whenever the stored value drives the DOM or app
 * behaviour - Web Storage is user-writable, so its content is untrusted.
 */
export type StorageValueGuard<T> = (value: unknown) => value is T;

/**
 * Reads and parses a value from a Web Storage area.
 *
 * Strings are persisted verbatim (not JSON-quoted) by {@link writeStorageValue}
 * so that plain values stay readable from outside Angular - `main.ts` reads the
 * language preference before bootstrap - which is why an unparseable payload is
 * returned as its raw string rather than discarded.
 */
export function readStorageValue<T>(
  storage: Storage | null,
  key: string,
  isValid?: StorageValueGuard<T>
): T | null {
  const raw = storage?.getItem(key) ?? null;

  if (raw === null) {
    return null;
  }

  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }

  if (isValid) {
    return isValid(value) ? value : null;
  }

  return value as T;
}

export function writeStorageValue(
  storage: Storage | null,
  key: string,
  value: unknown
): void {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  storage?.setItem(key, serialized);
}
