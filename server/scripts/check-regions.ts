/**
 * Checks the region constants (`doc/architecture.md` 12.8, MR-12 and MR-23).
 *
 * 1. No production file outside `shared/src/constants/data-region.constants.ts`
 *    names a region literal: a string whose contextual type is `DataRegion`
 *    (an assignment, an argument, a return value, a comparison, a `case`). A
 *    new region is then an entry of the constants, and no other code assumes
 *    a count of regions. The check reads the type, not the text, because
 *    `'ru'` is also a language, a billing region and a legal jurisdiction.
 * 2. No country is listed by two regions in `REGIONS`.
 *
 * The program resolves only the files of the repository, never
 * `node_modules`: the CI job installs only `server/`, and the type comes from
 * `shared/` alone. A literal whose context is an unresolved package type is
 * not a region literal. The keys of an object literal are not checked: a
 * `Record<DataRegion, T>` does not compile without an entry for each region.
 *
 * Usage (from server/): npm run check:regions
 *        npm run check:regions -- --self-test
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import { DATA_REGIONS, REGIONS } from '@app/shared/constants';

const REPO = path.resolve(__dirname, '../..');
const CONSTANTS_FILE = path.join(
  REPO,
  'shared/src/constants/data-region.constants.ts'
);
const ROOTS = ['server/src', 'mock-server/src', 'client/src', 'shared/src'];
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '__tests__',
  'testing',
  'test-utils'
]);
const REGION_TYPE = /\bDataRegion\b/;
const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }

  return out;
}

function createProgram(files: string[], base: string): ts.Program {
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    types: [],
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    experimentalDecorators: true,
    baseUrl: base,
    paths: {
      '@app/shared/*': ['shared/src/*'],
      '@core/*': ['client/src/app/core/*'],
      '@features/*': ['client/src/app/features/*'],
      '@shared/*': ['client/src/app/shared/*'],
      '@environments/*': ['client/src/environments/*']
    }
  };
  const host = ts.createCompilerHost(options);

  host.resolveModuleNames = (names, containingFile) =>
    names.map((name) => {
      const { resolvedModule } = ts.resolveModuleName(
        name,
        containingFile,
        options,
        host
      );

      return resolvedModule?.isExternalLibraryImport
        ? undefined
        : resolvedModule;
    });

  return ts.createProgram(files, options, host);
}

// The type that a region literal must fit at this place, when it has one.
function expectedType(
  checker: ts.TypeChecker,
  node: ts.StringLiteralLike
): ts.Type | undefined {
  const contextual = checker.getContextualType(node);

  if (contextual) return contextual;

  const { parent } = node;

  if (ts.isBinaryExpression(parent) && EQUALITY.has(parent.operatorToken.kind))
    return checker.getTypeAtLocation(
      parent.left === node ? parent.right : parent.left
    );

  if (ts.isCaseClause(parent))
    return checker.getTypeAtLocation(parent.parent.parent.expression);

  return undefined;
}

function regionLiterals(options: {
  files: string[];
  base: string;
  exempt: string;
  regions: readonly string[];
}): string[] {
  const { files, base, exempt, regions } = options;
  const program = createProgram(files, base);
  const checker = program.getTypeChecker();
  const violations: string[] = [];

  for (const file of files) {
    if (path.resolve(file) === path.resolve(exempt)) continue;

    const source = program.getSourceFile(file);

    if (!source) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node) && regions.includes(node.text)) {
        const type = expectedType(checker, node);

        if (type && REGION_TYPE.test(checker.typeToString(type))) {
          const { line } = source.getLineAndCharacterOfPosition(
            node.getStart(source)
          );

          violations.push(
            `${path.relative(base, file).replaceAll('\\', '/')}:${line + 1} '${node.text}'`
          );
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return violations;
}

function duplicateCountries(
  regions: Readonly<Record<string, { countries: readonly string[] }>>
): string[] {
  const owner = new Map<string, string>();
  const violations: string[] = [];

  for (const [region, { countries }] of Object.entries(regions)) {
    for (const country of countries) {
      const first = owner.get(country);

      if (first) violations.push(`${country}: ${first} and ${region}`);
      else owner.set(country, region);
    }
  }

  return violations;
}

function selfTest(): void {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-regions-'));
  const failures: string[] = [];

  try {
    const constants = path.join(base, 'shared/src/constants/regions.ts');
    const planted = path.join(base, 'server/src/planted.ts');

    fs.mkdirSync(path.dirname(constants), { recursive: true });
    fs.mkdirSync(path.dirname(planted), { recursive: true });
    fs.writeFileSync(
      constants,
      [
        "export type DataRegion = 'intl' | 'ru';",
        "export const HOME: DataRegion = 'intl';",
        'export type LegalJurisdiction = (typeof LEGAL)[number];',
        "export const LEGAL = ['ru', 'intl'] as const;",
        "export type Lang = 'en' | 'ru';",
        'export function take(region: DataRegion): void { void region; }'
      ].join('\n')
    );
    fs.writeFileSync(
      planted,
      [
        "import { type DataRegion, type LegalJurisdiction, type Lang, take } from '@app/shared/constants/regions';",
        "import { external } from 'not-installed';",
        'declare const region: DataRegion;',
        'declare const lang: Lang;',
        "export const r1: DataRegion = 'ru';",
        "export function r2(x: boolean): DataRegion { return x ? 'ru' : HOMELESS; }",
        "export const r3 = region === 'intl';",
        "take('ru');",
        "export const r5: DataRegion | undefined = 'intl';",
        "export const r6: { region: DataRegion } = { region: 'ru' };",
        "export function r7(r: DataRegion): number { switch (r) { case 'ru': return 1; default: return 0; } }",
        "export const n1: LegalJurisdiction = 'ru';",
        "export const n2 = lang === 'ru';",
        "external('ru');",
        'export const n4: Record<DataRegion, number> = { intl: 1, ru: 2 };',
        "export const n5 = 'ru';",
        'declare const HOMELESS: DataRegion;'
      ].join('\n')
    );

    const found = regionLiterals({
      files: [constants, planted],
      base,
      exempt: constants,
      regions: ['intl', 'ru']
    }).map((v) => v.replace(/^server\/src\/planted\.ts:/, ''));
    const expected = [
      "5 'ru'",
      "6 'ru'",
      "7 'intl'",
      "8 'ru'",
      "9 'intl'",
      "10 'ru'",
      "11 'ru'"
    ];

    if (found.join(',') !== expected.join(','))
      failures.push(
        `region literals: expected ${expected.join(', ')}, got ${found.join(', ') || 'none'}`
      );

    const dup = duplicateCountries({
      a: { countries: ['RU', 'KZ'] },
      b: { countries: ['KZ'] },
      c: { countries: [] }
    });

    if (dup.join(',') !== 'KZ: a and b')
      failures.push(`duplicate countries: got ${dup.join(', ') || 'none'}`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(
      `ERROR: check-regions self-test failed:\n  ${failures.join('\n  ')}`
    );
    process.exit(1);
  }

  console.log('check-regions: self-test OK.');
}

function main(): void {
  const files = ROOTS.flatMap((root) => walk(path.join(REPO, root)));
  const literals = regionLiterals({
    files,
    base: REPO,
    exempt: CONSTANTS_FILE,
    regions: DATA_REGIONS
  });
  const duplicates = duplicateCountries(REGIONS);
  const errors: string[] = [];

  if (literals.length > 0)
    errors.push(
      'a region literal outside shared/src/constants/data-region.constants.ts. Read the region from the constants (HOME_DATA_REGION, REGIONS, regionForCountry) or from the config of the pool:\n' +
        literals.map((v) => `  ${v}`).join('\n')
    );

  if (duplicates.length > 0)
    errors.push(
      'a country listed by two regions in REGIONS:\n' +
        duplicates.map((v) => `  ${v}`).join('\n')
    );

  if (errors.length > 0) {
    console.error(`ERROR: ${errors.join('\nERROR: ')}`);
    process.exit(1);
  }

  console.log(
    `check-regions: ${files.length} files, no region literal outside the constants; each country has at most one region.`
  );
}

if (process.argv.includes('--self-test')) selfTest();
else main();
