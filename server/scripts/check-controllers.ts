/**
 * Verifies the layout of the controller files and their serializer.
 *
 * - A folder that has a `controllers/` subfolder holds no controller itself.
 * - A folder with no `controllers/` subfolder holds at most one controller:
 *   the controller of that sub-feature, beside its service.
 * - Each controller in a `controllers/` folder has a class-level
 *   `@UseInterceptors(ClassSerializerInterceptor)`, so an `@Exclude` field of
 *   a returned entity cannot leak.
 *
 * Usage (from server/): npm run check:controllers
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC_DIR = path.resolve(__dirname, '../src');
const CONTROLLERS_DIR = 'controllers';
const SERIALIZER =
  /@UseInterceptors\([^)]*\bClassSerializerInterceptor\b[^)]*\)\s*(?:@[\s\S]*?)?export class/;

function listDirs(dir: string): string[] {
  const subdirs = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(dir, e.name));
  return [dir, ...subdirs.flatMap(listDirs)];
}

function controllersIn(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.controller.ts'))
    .map((f) => path.join(dir, f));
}

function main(): void {
  const errors: string[] = [];
  let count = 0;

  for (const dir of listDirs(SRC_DIR)) {
    const files = controllersIn(dir);
    count += files.length;
    const rel = path.relative(SRC_DIR, dir).replace(/\\/g, '/');

    if (path.basename(dir) === CONTROLLERS_DIR) {
      for (const file of files) {
        if (!SERIALIZER.test(fs.readFileSync(file, 'utf-8'))) {
          errors.push(
            `${rel}/${path.basename(file)}: add @UseInterceptors(ClassSerializerInterceptor) to the class`
          );
        }
      }
      continue;
    }

    if (files.length === 0) continue;

    if (fs.existsSync(path.join(dir, CONTROLLERS_DIR))) {
      files.forEach((file) =>
        errors.push(
          `${rel}/${path.basename(file)}: move it into ${rel}/${CONTROLLERS_DIR}/`
        )
      );
    } else if (files.length > 1) {
      errors.push(
        `${rel}: ${files.length} controllers; put them in ${rel}/${CONTROLLERS_DIR}/`
      );
    }
  }

  if (errors.length > 0) {
    console.error(`✗ ${errors.length} controller layout error(s):\n`);
    errors.forEach((e) => console.error(`    ${e}`));
    process.exit(1);
  }

  console.log(`✓ ${count} controllers follow the layout`);
}

main();
