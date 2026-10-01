/**
 * Returns the warnings that `@ngrx/signals` prints in dev mode when a store
 * declares a member that an earlier feature already declares. Two state keys
 * with one name are one signal, so a test expects this list to be empty.
 */
export function storeOverrideWarnings(create: () => unknown): string[] {
  const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined);
  try {
    create();
    return warn.mock.calls
      .map((call) => call.join(' '))
      .filter((line) => line.includes('cannot be overridden'));
  } finally {
    warn.mockRestore();
  }
}
