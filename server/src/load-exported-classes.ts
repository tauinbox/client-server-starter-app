import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Loads every class that the matching files below a directory export, as the
 * TypeORM glob loader does. TypeORM matches a glob string with tinyglobby and
 * picomatch; a list of classes keeps that matcher out of the boot path and out
 * of the migration CLI.
 */
export function loadExportedClasses(
  dir: string,
  fileName: RegExp
): NewableFunction[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => fileName.test(file))
    .toSorted()
    .flatMap((file) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- TypeORM takes the classes synchronously, and the file list is known only at run time
      const exported = require(join(dir, file)) as Record<string, unknown>;

      return Object.values(exported).filter(
        (value): value is NewableFunction => typeof value === 'function'
      );
    });
}
