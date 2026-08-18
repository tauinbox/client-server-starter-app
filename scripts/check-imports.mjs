/**
 * Repo-wide import-hygiene check. Zero dependencies — runs on plain Node from
 * any workspace, because `shared/` has no package.json of its own and ESLint
 * cannot lint files outside the directory holding its config.
 *
 * Enforces four rules:
 *   1. No dependency cycles between modules.
 *   2. No file may import through a barrel that lives in its own directory —
 *      siblings are imported directly. That import is what turns a barrel from
 *      a facade into a cycle.
 *   3. No new barrels outside the allowlist below.
 *   4. A directory that HAS a barrel is entered through it — no deep path from
 *      outside. Rules 2 and 4 are the same principle read from either side: the
 *      barrel is the outside face of a directory and never its inside face.
 *      Without this, "always import shared/ through the barrel" was convention
 *      only, and 25 sites had drifted off it by the time the rule was written.
 *      Directories with no barrel (`shared/src/utils`, `shared/src/enums`) are
 *      untouched — deep paths are the only way in and stay correct.
 *
 * `--self-test` runs the four detectors against synthetic fixtures and fails
 * if any of them stays silent. A check that always passes is indistinguishable
 * from a clean repo, which is exactly how `import/no-cycle` sat dead.
 *
 * Exit code 1 if violations found.
 */

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = join(ROOT, 'shared/src');

const REPO_ROOTS = [
  { dir: SHARED, alias: {} },
  { dir: join(ROOT, 'server/src'), alias: { '@app/shared/': SHARED } },
  { dir: join(ROOT, 'mock-server/src'), alias: { '@app/shared/': SHARED } },
  {
    dir: join(ROOT, 'client/src'),
    alias: {
      '@app/shared/': SHARED,
      '@core/': join(ROOT, 'client/src/app/core'),
      '@features/': join(ROOT, 'client/src/app/features'),
      '@shared/': join(ROOT, 'client/src/app/shared'),
      '@environments/': join(ROOT, 'client/src/environments')
    }
  }
];

/**
 * Barrels that predate this rule and are deliberately kept: the two `shared/`
 * ones are the cross-workspace public API of a package three workspaces
 * consume, and nothing inside `shared/` imports them. Adding to this list
 * means arguing that a new barrel earns the same exemption.
 */
const ALLOWED_BARRELS = [
  'shared/src/types/index.ts',
  'shared/src/constants/index.ts',
  'server/src/common/dtos/index.ts',
  'server/src/modules/core/filters/index.ts'
];

/**
 * Roots whose barrels are a package's *outside* face only. Files within such a
 * root import each other by deep path and must never route through the barrel:
 * `shared/src/types/index.ts` re-exports `feature-flag.types`, which imports
 * `../constants/feature-flag.constants`, while `constants/index.ts` re-exports
 * `billing-flags.constants`, which imports `../types/billing.types` — routing
 * either through its barrel closes a four-node cycle across the two barrels.
 * Rule 4 therefore skips importers inside these roots; deep paths there are the
 * thing keeping the public barrels acyclic, not drift away from them.
 */
const PACKAGE_API_ROOTS = [SHARED];

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.angular',
  'migrations'
]);
const SPEC = /\.(spec|test-d)\.ts$/;
// TypeORM's bidirectional relations need the related class as a value inside a
// lazily-evaluated arrow, so `import type` is not an option and the resulting
// cycle is inherent to the ORM rather than a design slip.
const ENTITY = /\.entity\.ts$/;

const FROM =
  /(?:^|\n)\s*(?:import|export)\s+(?:(type)\s+)?(?:[\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;
const BARE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const REEXPORT =
  /(?:^|\n)\s*export\s+(?:type\s+)?(?:\*|\{)[\s\S]*?from\s*['"]([^'"]+)['"]/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(normalize(full));
    }
  }
  return out;
}

function specifiers(src) {
  const found = [];
  for (const [re, typeIdx, specIdx] of [
    [FROM, 1, 2],
    [BARE, null, 1],
    [DYNAMIC, null, 1]
  ]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      found.push({
        spec: m[specIdx],
        typeOnly: typeIdx !== null && m[typeIdx] === 'type'
      });
    }
  }
  return found;
}

function resolveSpec(spec, fromFile, alias) {
  let base = null;
  for (const [prefix, target] of Object.entries(alias)) {
    if (spec.startsWith(prefix)) base = join(target, spec.slice(prefix.length));
  }
  if (!base && (spec.startsWith('./') || spec.startsWith('../'))) {
    base = resolve(dirname(fromFile), spec.replace(/\.js$/, ''));
  }
  if (!base) return null;
  for (const candidate of [`${base}.ts`, base, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return normalize(candidate);
    } catch {
      // Not this candidate — try the next shape.
    }
  }
  return null;
}

function analyse({ base, roots, allowed, packageApiRoots = [] }) {
  const rel = (p) => relative(base, p).split(sep).join('/');
  const violations = {
    cycles: [],
    selfBarrel: [],
    newBarrel: [],
    deepImport: []
  };

  const barrels = new Set();
  for (const { dir } of roots) {
    for (const file of walk(dir)) {
      if (!file.endsWith(`${sep}index.ts`)) continue;
      REEXPORT.lastIndex = 0;
      if (!REEXPORT.test(readFileSync(file, 'utf8'))) continue; // wiring, not a barrel
      barrels.add(file);
      if (!allowed.includes(rel(file))) violations.newBarrel.push(rel(file));
    }
  }

  // Deepest barrel whose directory contains the file, so a nested barrel wins
  // over an outer one instead of both claiming the same target.
  const barrelOwning = (file) => {
    let owner = null;
    for (const barrel of barrels) {
      const inside = `${dirname(barrel)}${sep}`;
      if (!file.startsWith(inside)) continue;
      if (!owner || inside.length > `${dirname(owner)}${sep}`.length) {
        owner = barrel;
      }
    }
    return owner;
  };

  const graph = new Map();
  const typeOnly = new Set();
  for (const { dir, alias } of roots) {
    for (const file of walk(dir)) {
      const deps = [];
      for (const { spec, typeOnly: isType } of specifiers(
        readFileSync(file, 'utf8')
      )) {
        const target = resolveSpec(spec, file, alias);
        if (!target) continue;
        deps.push(target);
        if (isType) typeOnly.add(`${file}|${target}`);
        if (
          barrels.has(target) &&
          file.startsWith(`${dirname(target)}${sep}`)
        ) {
          violations.selfBarrel.push(`${rel(file)} -> ${spec}`);
        }
        const owner = barrelOwning(target);
        const internalToPackage = packageApiRoots.some(
          (root) =>
            file.startsWith(`${root}${sep}`) &&
            owner?.startsWith(`${root}${sep}`)
        );
        if (
          owner &&
          target !== owner &&
          !internalToPackage &&
          !file.startsWith(`${dirname(owner)}${sep}`)
        ) {
          violations.deepImport.push(
            `${rel(file)} -> ${spec}  (use ${rel(dirname(owner))})`
          );
        }
      }
      // Specs are checked for import hygiene but kept out of the graph: a spec
      // is a leaf nothing imports, so it cannot participate in a runtime cycle.
      if (!SPEC.test(file)) graph.set(file, deps);
    }
  }

  const state = new Map();
  const stack = [];
  const seen = new Set();
  const visit = (node) => {
    state.set(node, 1);
    stack.push(node);
    for (const dep of graph.get(node) ?? []) {
      if (!graph.has(dep)) continue;
      const s = state.get(dep) ?? 0;
      if (s === 1) {
        const cycle = stack.slice(stack.indexOf(dep)).concat([dep]);
        const erased = cycle
          .slice(0, -1)
          .every((f, i) => typeOnly.has(`${f}|${cycle[i + 1]}`));
        if (cycle.some((f) => ENTITY.test(f)) || erased) continue;
        const key = [...cycle].slice(0, -1).sort().join('>');
        if (!seen.has(key)) {
          seen.add(key);
          violations.cycles.push(cycle.map(rel));
        }
      } else if (s === 0) {
        visit(dep);
      }
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const node of graph.keys()) if (!state.get(node)) visit(node);

  return { violations, moduleCount: graph.size, barrelCount: barrels.size };
}

function report({ violations }) {
  let failed = false;

  if (violations.cycles.length) {
    failed = true;
    console.error(
      `ERROR: ${violations.cycles.length} dependency cycle(s) found.\n`
    );
    for (const cycle of violations.cycles)
      console.error(`  ${cycle.join('\n    -> ')}\n`);
  }

  if (violations.selfBarrel.length) {
    failed = true;
    console.error(
      'ERROR: file imports through a barrel in its own directory.\n' +
        'Import the sibling module directly — a barrel that re-exports the\n' +
        'importer closes a cycle through itself.\n'
    );
    for (const v of [...new Set(violations.selfBarrel)])
      console.error(`  ${v}`);
    console.error('');
  }

  if (violations.newBarrel.length) {
    failed = true;
    console.error(
      'ERROR: new barrel (index.ts re-export file) outside the allowlist.\n' +
        'Import modules directly. If this barrel is a package API that earns an\n' +
        'exemption, add it to ALLOWED_BARRELS in scripts/check-imports.mjs and\n' +
        'say why in the PR.\n'
    );
    for (const v of violations.newBarrel) console.error(`  ${v}`);
    console.error('');
  }

  if (violations.deepImport.length) {
    failed = true;
    console.error(
      'ERROR: deep import into a directory that has a barrel.\n' +
        'Import the directory itself — the barrel is its public face. If the\n' +
        'symbol is missing from the barrel, add the re-export there.\n'
    );
    for (const v of [...new Set(violations.deepImport)])
      console.error(`  ${v}`);
    console.error('');
  }

  return failed;
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'check-imports-'));
  const write = (p, body) => {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  };
  const failures = [];
  const expect = (label, actual) => {
    if (!actual) failures.push(label);
  };

  try {
    write(
      'src/cycle-a.ts',
      "import { b } from './cycle-b';\nexport const a = () => b;\n"
    );
    write(
      'src/cycle-b.ts',
      "import { a } from './cycle-a';\nexport const b = () => a;\n"
    );
    write('src/pkg/index.ts', "export { thing } from './thing';\n");
    write(
      'src/pkg/thing.ts',
      "import { other } from './index';\nexport const thing = other;\n"
    );
    write('src/pkg/other.ts', 'export const other = 1;\n');
    write(
      'src/deep-consumer.ts',
      "import { other } from './pkg/other';\nexport const used = other;\n"
    );
    write(
      'src/pkg/sibling.ts',
      "import { other } from './other';\nexport const near = other;\n"
    );
    write('src/unbarrelled/loose.ts', 'export const loose = 1;\n');
    write(
      'src/unbarrelled-consumer.ts',
      "import { loose } from './unbarrelled/loose';\nexport const used2 = loose;\n"
    );
    write(
      'src/deep-consumer.spec.ts',
      "import { other } from './pkg/other';\nexport const spec = other;\n"
    );
    write(
      'src/one.entity.ts',
      "import { Two } from './two.entity';\nexport class One { t: Two; }\n"
    );
    write(
      'src/two.entity.ts',
      "import { One } from './one.entity';\nexport class Two { o: One; }\n"
    );
    write(
      'src/t-a.ts',
      "import type { B } from './t-b';\nexport type A = { b: B };\n"
    );
    write(
      'src/t-b.ts',
      "import type { A } from './t-a';\nexport type B = { a: A };\n"
    );

    const roots = [{ dir: join(dir, 'src'), alias: {} }];
    const { violations } = analyse({ base: dir, roots, allowed: [] });

    expect(
      'cycle detector stayed silent on a two-file cycle',
      violations.cycles.some((c) => c.join(' ').includes('cycle-a.ts'))
    );
    expect(
      'self-barrel detector stayed silent',
      violations.selfBarrel.some((v) => v.includes('pkg/thing.ts'))
    );
    expect(
      'new-barrel detector stayed silent',
      violations.newBarrel.includes('src/pkg/index.ts')
    );
    expect(
      'entity cycle was reported despite the TypeORM exemption',
      !violations.cycles.some((c) => c.join(' ').includes('one.entity.ts'))
    );
    expect(
      'type-only cycle was reported despite being erased at compile time',
      !violations.cycles.some((c) => c.join(' ').includes('t-a.ts'))
    );
    expect(
      'deep-import detector stayed silent on a barrelled directory',
      violations.deepImport.some((v) => v.startsWith('src/deep-consumer.ts'))
    );
    expect(
      'deep-import detector skipped a spec file',
      violations.deepImport.some((v) =>
        v.startsWith('src/deep-consumer.spec.ts')
      )
    );
    expect(
      'deep-import detector fired on a sibling inside the barrelled directory',
      !violations.deepImport.some((v) => v.startsWith('src/pkg/sibling.ts'))
    );
    expect(
      'deep-import detector fired on a directory with no barrel',
      !violations.deepImport.some((v) =>
        v.startsWith('src/unbarrelled-consumer.ts')
      )
    );

    const clean = analyse({
      base: dir,
      roots: [{ dir: join(dir, 'src', 'pkg'), alias: {} }],
      allowed: ['src/pkg/index.ts']
    });
    expect(
      'allowlist did not suppress an allowed barrel',
      clean.violations.newBarrel.length === 0
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(
      'ERROR: check-imports self-test failed — the check is not detecting:\n'
    );
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`check-imports: self-test OK — all detectors fire.`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const result = analyse({
    base: ROOT,
    roots: REPO_ROOTS,
    allowed: ALLOWED_BARRELS,
    packageApiRoots: PACKAGE_API_ROOTS
  });
  if (report(result)) process.exit(1);
  console.log(
    `check-imports: OK — ${result.moduleCount} modules, ${result.barrelCount} allowed barrel(s), no cycles.`
  );
}
