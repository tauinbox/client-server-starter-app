/** A third-party script that exposes a global API when it loads. */
export type ExternalScript<T> = {
  /** Used in the error messages. */
  name: string;
  id: string;
  src: string;
  /** Reads the global API that the script exposes. */
  api: () => T | undefined;
};

/**
 * Appends the script tag once and resolves with the global API. It resolves
 * at once when the API is already there, and joins a tag that is already in
 * the page.
 */
export function loadExternalScript<T>(
  document: Document,
  script: ExternalScript<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const loaded = script.api();
    if (loaded) {
      resolve(loaded);
      return;
    }

    // A tag left behind by a failed attempt never fires another event, so it
    // is dropped on failure and the next attempt appends a fresh one.
    const attach = (tag: HTMLScriptElement) => {
      const fail = (message: string) => {
        tag.remove();
        reject(new Error(message));
      };
      tag.addEventListener(
        'load',
        () => {
          const api = script.api();
          if (api) resolve(api);
          else fail(`${script.name} script loaded without exposing API`);
        },
        { once: true }
      );
      tag.addEventListener(
        'error',
        () => fail(`Failed to load ${script.name} script`),
        { once: true }
      );
    };

    const existing = document.getElementById(
      script.id
    ) as HTMLScriptElement | null;
    if (existing) {
      attach(existing);
      return;
    }

    const tag = document.createElement('script');
    tag.id = script.id;
    tag.src = script.src;
    tag.async = true;
    tag.defer = true;
    attach(tag);
    document.head.appendChild(tag);
  });
}
