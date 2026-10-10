/**
 * Verifies the layout of the controller files and their serializer.
 *
 * - A folder that has a `controllers/` subfolder holds no controller itself.
 * - A folder with no `controllers/` subfolder holds at most one controller:
 *   the controller of that sub-feature, beside its service.
 * - No controller registers `ClassSerializerInterceptor`: `CoreModule`
 *   registers it for every route (`RESPONSE_SERIALIZER`), and a second one
 *   serializes each response twice.
 * - A test module that mounts a production controller without `CoreModule`
 *   adds `RESPONSE_SERIALIZER`.
 *
 * Usage (from server/): npm run check:controllers
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC_DIR = path.resolve(__dirname, '../src');
const TEST_DIR = path.resolve(__dirname, '../test');
const CONTROLLERS_DIR = 'controllers';

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

function listFiles(dir: string, suffix: string): string[] {
  return listDirs(dir).flatMap((d) =>
    fs
      .readdirSync(d)
      .filter((f) => f.endsWith(suffix))
      .map((f) => path.join(d, f))
  );
}

/**
 * A test app that mounts a production controller without `CoreModule` must
 * add `RESPONSE_SERIALIZER`, or it asserts a response that production never
 * sends. A unit spec that calls the controller methods directly runs no
 * interceptor, so it is out of scope.
 */
function checkTestHarnesses(): string[] {
  const production = new Set(
    listFiles(SRC_DIR, '.controller.ts').flatMap((file) =>
      [
        ...fs
          .readFileSync(file, 'utf-8')
          .matchAll(/export class (\w+Controller)\b/g)
      ].map((m) => m[1])
    )
  );
  const specs = [
    ...listFiles(TEST_DIR, '.ts'),
    ...listFiles(SRC_DIR, '.spec.ts')
  ];
  const errors: string[] = [];

  for (const file of specs) {
    const modules = fs
      .readFileSync(file, 'utf-8')
      .split('createTestingModule(')
      .slice(1);
    modules.forEach((module, i) => {
      if (
        module.includes('CoreModule.forRoot') ||
        !module.includes('createNestApplication')
      ) {
        return;
      }
      const mounted = [...module.matchAll(/controllers:\s*\[([^\]]*)\]/g)]
        .slice(0, 1)
        .flatMap((m) => m[1].split(',').map((n) => n.trim()))
        .filter((n) => production.has(n));
      if (mounted.length > 0 && !module.includes('RESPONSE_SERIALIZER')) {
        const rel = path
          .relative(path.dirname(TEST_DIR), file)
          .replace(/\\/g, '/');
        errors.push(
          `${rel}: test module ${i + 1} mounts ${mounted.join(', ')}; add RESPONSE_SERIALIZER to its providers`
        );
      }
    });
  }

  return errors;
}

function main(): void {
  const errors: string[] = [];
  let count = 0;

  for (const dir of listDirs(SRC_DIR)) {
    const files = controllersIn(dir);
    count += files.length;
    const rel = path.relative(SRC_DIR, dir).replace(/\\/g, '/');

    for (const file of files) {
      if (
        fs.readFileSync(file, 'utf-8').includes('ClassSerializerInterceptor')
      ) {
        errors.push(
          `${rel}/${path.basename(file)}: remove ClassSerializerInterceptor, CoreModule applies it to every route`
        );
      }
    }

    if (files.length === 0 || path.basename(dir) === CONTROLLERS_DIR) continue;

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

  errors.push(...checkTestHarnesses());

  if (errors.length > 0) {
    console.error(`✗ ${errors.length} controller layout error(s):\n`);
    errors.forEach((e) => console.error(`    ${e}`));
    process.exit(1);
  }

  console.log(`✓ ${count} controllers follow the layout`);
}

main();
