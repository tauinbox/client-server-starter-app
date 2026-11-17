/**
 * Refuses a function that two or more workspaces define a second time.
 *
 * A pure function that more than one workspace needs has one definition in
 * `shared/src/utils/`, and each workspace imports it. A copy drifts: the mock
 * copy of a server rule changes behaviour when only one side is edited.
 *
 * Scans `server/src`, `mock-server/src` and `client/src`, with no spec file,
 * `__tests__/`, `test/` or `node_modules/`. Two tests:
 * - Name: a top-level function declaration, or a top-level `const` set to an
 *   arrow function or a function expression, exported or not, with the same
 *   name in two workspaces.
 * - Body: any named function or method whose body is the same in two workspaces
 *   after the names of its own parameters and locals are replaced by their
 *   position. Calls, property names and literals are kept, so a copy under a
 *   new name is found and two functions that only have the same form are not.
 *   A body shorter than `MIN_BODY_LENGTH` characters of tokens (comments do
 *   not count) is not compared. A callback with no name is not compared:
 *   `KEPT` could not name it.
 *
 * Two definitions in ONE workspace are not reported.
 *
 * A function that cannot move to `shared/src`, or two functions that only
 * share a name, stay with an entry in `KEPT` and its reason. An entry whose
 * name no finding contains fails too, so the list does not go stale.
 *
 * Usage (from server/): npm run check:duplicate-functions
 *        npm run check:duplicate-functions -- --self-test
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';

type Roots = Record<string, string>;

interface Definition {
  workspace: string;
  file: string;
  name: string;
}

interface Finding {
  kind: 'name' | 'body';
  definitions: Definition[];
}

const REPO_ROOT = path.resolve(__dirname, '../..');
const ROOTS: Roots = {
  server: path.join(REPO_ROOT, 'server/src'),
  'mock-server': path.join(REPO_ROOT, 'mock-server/src'),
  client: path.join(REPO_ROOT, 'client/src')
};
const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', 'test']);
const SPEC_FILE = /\.spec\.ts$/;
const MIN_BODY_LENGTH = 60;

/**
 * Functions that stay in more than one workspace, by name. Valid reasons: a
 * third-party import (the client e2e loads the mock in process, and a bare
 * specifier in `shared/src` resolves to no `node_modules`), an Express request
 * or response, a framework API of one workspace, or two different functions
 * that only share a name.
 */
const KEPT: Record<string, string> = {
  addInterval: 'a third-party import: temporal-polyfill',
  nextPeriodEnd: 'a third-party import: temporal-polyfill',
  utc: 'a third-party import: temporal-polyfill',
  normalizeIpAddress: 'a third-party import: ipaddr.js',
  readAnonId: 'an Express request; the cookie name differs on purpose',
  writeAnonId: 'an Express response; the cookie name differs on purpose',
  authGuard:
    'two different functions: an Express middleware and an Angular route guard',
  permissionGuard:
    'two different functions: an Express middleware and an Angular route guard',
  scopeOf:
    'an adapter of the ability type of each workspace (CASL AppAbility, MockAbility)',
  cancelOpenSubscription:
    'the provider call, the write and the events of each workspace; the rule is the shared cancelRefusal'
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (entry.name.endsWith('.ts') && !SPEC_FILE.test(entry.name)) {
      out.push(full);
    }
  }

  return out;
}

function isFunctionValue(
  node: ts.Node | undefined
): node is ts.ArrowFunction | ts.FunctionExpression {
  return !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

function topLevelNames(source: ts.SourceFile): string[] {
  const names: string[] = [];

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      names.push(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && isFunctionValue(decl.initializer)) {
          names.push(decl.name.text);
        }
      }
    }
  }

  return names;
}

function declaredNames(fn: ts.SignatureDeclaration): Set<string> {
  const names = new Set<string>();
  const addBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      names.add(name.text);
    } else {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) addBinding(element.name);
      }
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) || ts.isVariableDeclaration(node)) {
      addBinding(node.name);
    }

    ts.forEachChild(node, visit);
  };

  visit(fn);

  return names;
}

/** The body as tokens, with the own names of the function replaced. */
function normalizedBody(
  fn: ts.SignatureDeclaration & { body?: ts.Node },
  source: ts.SourceFile
): string | undefined {
  const { body } = fn;

  if (!body) return undefined;

  const own = declaredNames(fn);
  const renamed = new Map<string, string>();
  const tokens: string[] = [];
  const visit = (node: ts.Node): void => {
    if (node.getChildCount(source) > 0) {
      for (const child of node.getChildren(source)) visit(child);

      return;
    }

    if (ts.isIdentifier(node) && own.has(node.text)) {
      if (!renamed.has(node.text)) renamed.set(node.text, `$${renamed.size}`);

      tokens.push(renamed.get(node.text) ?? '');
    } else {
      tokens.push(node.getText(source));
    }
  };

  visit(body);

  const normalized = tokens.join(' ');

  return normalized.length < MIN_BODY_LENGTH ? undefined : normalized;
}

/** The name of a function, or undefined for a callback with no name. */
function functionName(
  node: ts.Node,
  source: ts.SourceFile
): string | undefined {
  if (
    (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
    node.name
  ) {
    return node.name.getText(source);
  }

  if (
    isFunctionValue(node) &&
    (ts.isVariableDeclaration(node.parent) ||
      ts.isPropertyAssignment(node.parent) ||
      ts.isPropertyDeclaration(node.parent))
  ) {
    return node.parent.name.getText(source);
  }

  return undefined;
}

function add(
  map: Map<string, Definition[]>,
  key: string,
  def: Definition
): void {
  const list = map.get(key) ?? [];

  list.push(def);
  map.set(key, list);
}

function collect(roots: Roots): Finding[] {
  const byName = new Map<string, Definition[]>();
  const byBody = new Map<string, Definition[]>();

  for (const [workspace, root] of Object.entries(roots)) {
    for (const full of walk(root)) {
      const source = ts.createSourceFile(
        full,
        fs.readFileSync(full, 'utf8'),
        ts.ScriptTarget.Latest,
        true
      );
      const file = path
        .relative(path.dirname(root), full)
        .replaceAll('\\', '/');

      for (const name of topLevelNames(source)) {
        add(byName, name, { workspace, file, name });
      }

      const visit = (node: ts.Node): void => {
        const name = functionName(node, source);

        if (
          name !== undefined &&
          (ts.isFunctionDeclaration(node) ||
            ts.isMethodDeclaration(node) ||
            isFunctionValue(node))
        ) {
          const body = normalizedBody(node, source);

          if (body !== undefined) add(byBody, body, { workspace, file, name });
        }

        ts.forEachChild(node, visit);
      };

      visit(source);
    }
  }

  const crossWorkspace = (list: Definition[]): boolean =>
    new Set(list.map(({ workspace }) => workspace)).size > 1;

  return [
    ...[...byName.values()]
      .filter(crossWorkspace)
      .map((definitions): Finding => ({ kind: 'name', definitions })),
    ...[...byBody.values()]
      .filter(crossWorkspace)
      .map((definitions): Finding => ({ kind: 'body', definitions }))
  ];
}

function describe({ kind, definitions }: Finding): string {
  const names = [...new Set(definitions.map(({ name }) => name))].join(' = ');
  const sites = definitions
    .map(({ workspace, file }) => `${workspace}/${file}`)
    .join(', ');

  return `${names} (same ${kind}): ${sites}`;
}

function check(roots: Roots, kept: Record<string, string>): string[] {
  const findings = collect(roots);
  const errors = findings
    .filter(
      ({ definitions }) =>
        !definitions.every(({ name }) => Object.hasOwn(kept, name))
    )
    .map(describe);
  const found = new Set(
    findings.flatMap(({ definitions }) => definitions.map(({ name }) => name))
  );

  for (const name of Object.keys(kept)) {
    if (!found.has(name)) {
      errors.push(`${name}: in KEPT, but no workspace repeats it any more`);
    }
  }

  return [...new Set(errors)].toSorted();
}

function selfTest(): void {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-dup-fns-'));
  const write = (rel: string, body: string): void => {
    const full = path.join(base, rel);

    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };
  const longBody = (fn: string, arg: string): string =>
    `function ${fn}(${arg}: string) { return ${arg}.trim().toLowerCase().replaceAll('a', 'b').slice(0, 10); }`;

  try {
    write('a/src/x.ts', 'export function dup() {}\nexport function kept() {}');
    write(
      'b/src/y.ts',
      'export const dup = () => 1;\nexport function kept() {}'
    );
    write('b/src/same.ts', 'function onlyB() {}');
    write('b/src/other.ts', 'function onlyB() {}');
    write('a/src/z.spec.ts', 'export function inSpec() {}');
    write('b/src/__tests__/t.ts', 'export function inSpec() {}');
    write('a/src/r1.ts', longBody('renamedA', 'value'));
    write(
      'b/src/r2.ts',
      `class C { renamedB${longBody('', 'input').slice('function '.length)} }`
    );
    write(
      'a/src/f1.ts',
      'function formA(v: string) { return v.trim().toLowerCase().replaceAll("a", "b").slice(0, 10); }'
    );
    write(
      'b/src/f2.ts',
      'function formB(v: string) { return v.trim().toUpperCase().replaceAll("a", "b").slice(0, 10); }'
    );

    const roots = { a: path.join(base, 'a/src'), b: path.join(base, 'b/src') };
    const found = check(roots, { kept: 'reason', stale: 'reason' }).map((e) =>
      e.split(' ')[0].replace(/:$/, '')
    );
    const expected = ['dup', 'renamedA', 'stale'];

    if (found.join(',') !== expected.join(',')) {
      console.error(
        `ERROR: check-duplicate-functions self-test failed: expected ${expected.join(', ')}, got ${found.join(', ') || 'none'}.`
      );
      process.exit(1);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }

  console.log('check-duplicate-functions: self-test OK.');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const errors = check(ROOTS, KEPT);

  if (errors.length > 0) {
    console.error(
      'ERROR: a function that two or more workspaces define. Move it to shared/src/utils/ and import it in each workspace, or add it to KEPT in server/scripts/check-duplicate-functions.ts with the reason it stays:\n' +
        errors.map((e) => `  ${e}`).join('\n')
    );
    process.exit(1);
  }

  console.log(
    'check-duplicate-functions: no function is defined in two workspaces.'
  );
}
