/**
 * Verifies the access policy that each entry of contracts/routes/*.json
 * declares in its `policy` field. It fails when:
 *
 *  1. a policy field differs from the decorators of the handler and of its
 *     class (`@Public`, `@OptionalAuth`, `@Authorize`, `@StepUpRoute`,
 *     `@CountFailuresOnlyWhenBody`, `@SkipMfaEnrolmentGate`, `@Throttle`,
 *     `@SkipThrottle`), or an entry has no valid policy;
 *  2. two routes with the same `writes` have a different `access`, and
 *     neither carries `accessExempt`;
 *  3. a handler whose `@Body()` is a step-up DTO has no `@StepUpRoute`;
 *  4. the mock-server route has a different gate (`authGuard`,
 *     `permissionGuard(action, subject)` or none) or no route at all.
 *
 * Usage (from server/): npm run check:route-policy [-- --self-test]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import {
  type ControllerRoute,
  decoratorArgs,
  decoratorName,
  extractRoutes,
  findControllers
} from './lib/controller-routes';

const REPO_ROOT = path.resolve(__dirname, '../..');
const ROUTES_DIR = path.join(REPO_ROOT, 'contracts/routes');
const THROTTLE_CONSTANTS = path.join(
  REPO_ROOT,
  'server/src/modules/auth/constants/throttle.constants.ts'
);
const MOCK_INDEX = path.join(REPO_ROOT, 'mock-server/src/middleware/index.ts');

const STEP_UP_BODIES = new Set(['StepUpFactorsDto', 'MfaSetupDto']);

type Throttle = string[] | 'skip' | null;

interface Policy {
  access: string;
  writes: string | null;
  stepUp: boolean;
  countFailuresOnlyWhenBody: boolean;
  skipMfaEnrolmentGate: boolean;
  throttle: Throttle;
  accessExempt?: string;
}

interface ContractEntry {
  method: string;
  path: string;
  file: string;
  policy?: Policy;
}

type MockGate =
  | { kind: 'public' }
  | { kind: 'signed-in' }
  | { kind: 'permission'; access: string; skipMfaEnrolmentGate: boolean };

interface MockRoute {
  method: string;
  segments: string[];
  gate: MockGate;
  site: string;
}

interface Input {
  routes: ControllerRoute[];
  contract: ContractEntry[];
  mock: MockRoute[];
  throttleConstants: Map<string, string[]>;
}

// --- server side ---

function find(
  decorators: readonly ts.Decorator[],
  name: string
): ts.Decorator | undefined {
  return decorators.find((d) => decoratorName(d) === name);
}

function propertyNames(node: ts.ObjectLiteralExpression): string[] {
  return node.properties.flatMap((p) => {
    if (!p.name) return [];
    if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) {
      return [p.name.text];
    }
    return [];
  });
}

/** Exported `const X = { ... }` of a file, mapped to their keys. */
export function objectConstants(source: string): Map<string, string[]> {
  const sf = ts.createSourceFile('c.ts', source, ts.ScriptTarget.Latest, true);
  const result = new Map<string, string[]>();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.initializer &&
        ts.isObjectLiteralExpression(decl.initializer)
      ) {
        result.set(decl.name.text, propertyNames(decl.initializer));
      }
    }
  }
  return result;
}

function throttleNames(
  arg: ts.Expression | undefined,
  constants: Map<string, string[]>
): string[] {
  if (!arg) return [];
  if (ts.isObjectLiteralExpression(arg)) return propertyNames(arg);
  if (ts.isIdentifier(arg) && constants.has(arg.text)) {
    return constants.get(arg.text) ?? [];
  }
  throw new Error(`cannot read the throttle names of "${arg.getText()}"`);
}

function accessOf(d: ts.Decorator): string {
  return (decoratorArgs(d) ?? [])
    .map((check) =>
      ts.isArrayLiteralExpression(check)
        ? check.elements
            .map((e) => (ts.isStringLiteral(e) ? e.text : e.getText()))
            .join(':')
        : check.getText()
    )
    .join(' & ');
}

export function derivePolicy(
  route: ControllerRoute,
  constants: Map<string, string[]>
): Omit<Policy, 'writes' | 'accessExempt'> {
  const own = route.decorators;
  const cls = route.classDecorators;
  const either = (name: string) => find(own, name) ?? find(cls, name);

  let access = 'signed-in';
  if (either('Public')) access = 'public';
  else if (either('OptionalAuth')) access = 'optional';
  else {
    const authorize = either('Authorize');
    if (authorize) access = accessOf(authorize);
  }

  const stepUp = find(own, 'StepUpRoute');
  let throttle: Throttle = null;
  if (either('SkipThrottle')) {
    throttle = 'skip';
  } else {
    const names = new Set<string>();
    for (const d of [find(cls, 'Throttle'), find(own, 'Throttle')]) {
      if (d)
        throttleNames(decoratorArgs(d)?.[0], constants).forEach((n) =>
          names.add(n)
        );
    }
    if (stepUp) {
      const arg = decoratorArgs(stepUp)?.[1];
      const fromStepUp = arg
        ? throttleNames(arg, constants)
        : (constants.get('CHALLENGE_THROTTLE') ?? []);
      fromStepUp.forEach((n) => names.add(n));
    }
    if (names.size > 0) throttle = [...names].sort();
  }

  return {
    access,
    stepUp: stepUp !== undefined,
    countFailuresOnlyWhenBody:
      stepUp !== undefined || either('CountFailuresOnlyWhenBody') !== undefined,
    skipMfaEnrolmentGate: either('SkipMfaEnrolmentGate') !== undefined,
    throttle
  };
}

// --- mock side ---

function pathSegments(p: string): string[] {
  return p.split('/').filter(Boolean);
}

function literalPath(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return (
      node.head.text +
      node.templateSpans.map((s) => '*' + s.literal.text).join('')
    );
  }
  return undefined;
}

function gateOf(args: readonly ts.Expression[]): MockGate {
  for (const arg of args) {
    if (ts.isIdentifier(arg) && arg.text === 'authGuard') {
      return { kind: 'signed-in' };
    }
    if (
      ts.isCallExpression(arg) &&
      ts.isIdentifier(arg.expression) &&
      arg.expression.text === 'permissionGuard'
    ) {
      const [action, subject, options] = arg.arguments;
      const skip =
        options !== undefined &&
        ts.isObjectLiteralExpression(options) &&
        options.properties.some(
          (p) =>
            ts.isPropertyAssignment(p) &&
            p.name.getText() === 'skipMfaEnrolmentGate' &&
            p.initializer.kind === ts.SyntaxKind.TrueKeyword
        );
      const text = (e: ts.Expression | undefined) =>
        e && ts.isStringLiteral(e) ? e.text : (e?.getText() ?? '');
      return {
        kind: 'permission',
        access: `${text(action)}:${text(subject)}`,
        skipMfaEnrolmentGate: skip
      };
    }
  }
  return { kind: 'public' };
}

/**
 * The routes of the mock server in Express order: the `app.use` order of the
 * index, then the order of the calls in each router file. The first route
 * that matches a path is the one Express runs.
 */
export function parseMockRoutes(
  indexFile: string,
  read: (file: string) => string
): MockRoute[] {
  const index = ts.createSourceFile(
    indexFile,
    read(indexFile),
    ts.ScriptTarget.Latest,
    true
  );
  const imported = new Map<string, { file: string; name: string }>();
  for (const stmt of index.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const file = path.resolve(
      path.dirname(indexFile),
      `${stmt.moduleSpecifier.text}.ts`
    );
    const clause = stmt.importClause;
    if (clause.name) imported.set(clause.name.text, { file, name: 'default' });
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        imported.set(el.name.text, {
          file,
          name: (el.propertyName ?? el.name).text
        });
      }
    }
  }

  const mounts: { prefix: string; ident: string }[] = [];
  const visitIndex = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'use' &&
      node.arguments.length === 2 &&
      ts.isStringLiteral(node.arguments[0]) &&
      ts.isIdentifier(node.arguments[1])
    ) {
      mounts.push({
        prefix: node.arguments[0].text,
        ident: node.arguments[1].text
      });
    }
    ts.forEachChild(node, visitIndex);
  };
  visitIndex(index);

  const routes: MockRoute[] = [];
  for (const mount of mounts) {
    const target = imported.get(mount.ident);
    if (!target) continue;
    const sf = ts.createSourceFile(
      target.file,
      read(target.file),
      ts.ScriptTarget.Latest,
      true
    );
    const local = localExportName(sf, target.name);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === local &&
        ['get', 'post', 'put', 'patch', 'delete'].includes(
          node.expression.name.text
        )
      ) {
        const routePath = literalPath(node.arguments[0]);
        if (routePath !== undefined) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          routes.push({
            method: node.expression.name.text.toUpperCase(),
            segments: pathSegments(`${mount.prefix}/${routePath}`),
            gate: gateOf(node.arguments.slice(1, -1)),
            site: `${path.relative(REPO_ROOT, target.file).replace(/\\/g, '/')}:${line + 1}`
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return routes;
}

function localExportName(sf: ts.SourceFile, exported: string): string {
  for (const stmt of sf.statements) {
    if (
      exported === 'default' &&
      ts.isExportAssignment(stmt) &&
      ts.isIdentifier(stmt.expression)
    ) {
      return stmt.expression.text;
    }
    if (
      ts.isExportDeclaration(stmt) &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      for (const el of stmt.exportClause.elements) {
        if (el.name.text === exported) return (el.propertyName ?? el.name).text;
      }
    }
  }
  return exported;
}

function segmentMatches(mock: string, sample: string): boolean {
  if (mock.startsWith(':')) return true;
  if (!mock.includes('*')) return mock === sample;
  const pattern = mock
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.+');
  return new RegExp(`^${pattern}$`).test(sample);
}

function findMockRoute(
  mock: MockRoute[],
  method: string,
  samplePath: string
): MockRoute | undefined {
  const want = pathSegments(samplePath);
  return mock.find(
    (r) =>
      r.method === method &&
      r.segments.length === want.length &&
      r.segments.every((s, i) => segmentMatches(s, want[i]))
  );
}

// --- rules ---

const POLICY_FIELDS = [
  'access',
  'stepUp',
  'countFailuresOnlyWhenBody',
  'skipMfaEnrolmentGate',
  'throttle'
] as const;

function validPolicy(p: unknown): p is Policy {
  if (typeof p !== 'object' || p === null) return false;
  const v: Partial<Record<keyof Policy, unknown>> = p;
  const throttleOk =
    v.throttle === null ||
    v.throttle === 'skip' ||
    (Array.isArray(v.throttle) &&
      v.throttle.every((n) => typeof n === 'string'));
  return (
    typeof v.access === 'string' &&
    (v.writes === null || typeof v.writes === 'string') &&
    typeof v.stepUp === 'boolean' &&
    typeof v.countFailuresOnlyWhenBody === 'boolean' &&
    typeof v.skipMfaEnrolmentGate === 'boolean' &&
    throttleOk &&
    (v.accessExempt === undefined ||
      (typeof v.accessExempt === 'string' && v.accessExempt.length > 0))
  );
}

function show(value: unknown): string {
  return JSON.stringify(value);
}

export function evaluate(input: Input): string[] {
  const problems: string[] = [];
  const byKey = new Map(input.routes.map((r) => [`${r.method} ${r.path}`, r]));

  for (const entry of input.contract) {
    const key = `${entry.method} ${entry.path}`;
    const route = byKey.get(key);
    if (!route) continue; // check:routes reports a stale entry
    const where = `${key} (${entry.file})`;

    if (!validPolicy(entry.policy)) {
      problems.push(`[rule 1] ${where}: no valid "policy" field`);
      continue;
    }
    const policy = entry.policy;
    const actual = derivePolicy(route, input.throttleConstants);
    for (const field of POLICY_FIELDS) {
      if (show(policy[field]) !== show(actual[field])) {
        problems.push(
          `[rule 1] ${where}: ${field} is ${show(policy[field])} in the contract and ${show(actual[field])} in the decorators`
        );
      }
    }

    if (
      route.bodyType !== undefined &&
      STEP_UP_BODIES.has(route.bodyType) &&
      !actual.stepUp
    ) {
      problems.push(
        `[rule 3] ${where}: the body is ${route.bodyType}, and the handler has no @StepUpRoute`
      );
    }

    const mock = findMockRoute(input.mock, entry.method, entry.path);
    if (!mock) {
      problems.push(`[rule 4] ${where}: no mock-server route`);
    } else {
      const gate = mock.gate;
      const ok =
        policy.access === 'public' || policy.access === 'optional'
          ? gate.kind === 'public'
          : policy.access === 'signed-in'
            ? gate.kind === 'signed-in'
            : gate.kind === 'permission' &&
              gate.access === policy.access &&
              gate.skipMfaEnrolmentGate === policy.skipMfaEnrolmentGate;
      if (!ok) {
        problems.push(
          `[rule 4] ${where}: the mock gate at ${mock.site} is ${show(gate)}, the policy access is ${show(policy.access)}`
        );
      }
    }
  }

  const byWrites = new Map<string, ContractEntry[]>();
  for (const entry of input.contract) {
    const writes = entry.policy?.writes;
    if (!writes || entry.policy?.accessExempt) continue;
    byWrites.set(writes, [...(byWrites.get(writes) ?? []), entry]);
  }
  for (const [writes, entries] of byWrites) {
    const accesses = new Set(entries.map((e) => e.policy?.access));
    if (accesses.size > 1) {
      problems.push(
        `[rule 2] routes that write ${writes} have different access: ` +
          entries
            .map((e) => `${e.method} ${e.path} = ${e.policy?.access}`)
            .join('; ')
      );
    }
  }

  return problems;
}

// --- loading ---

function loadContract(): ContractEntry[] {
  return fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => {
      const { routes } = JSON.parse(
        fs.readFileSync(path.join(ROUTES_DIR, f), 'utf-8')
      ) as { routes: Omit<ContractEntry, 'file'>[] };
      return routes.map((r) => ({ ...r, file: `contracts/routes/${f}` }));
    });
}

function readFile(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

// --- self-test ---

const FIXTURE_CONTROLLER = `
@Controller({ path: 'things', version: '1' })
export class ThingsController {
  @Authorize(['update', 'Thing'])
  @Patch(':id')
  update(@Body() dto: UpdateThingDto) {}

  @Post(':id/archive')
  archive() {}

  @Throttle(CHALLENGE_THROTTLE)
  @Post('secure')
  secure(@Body() dto: StepUpFactorsDto) {}
}
`;

const FIXTURE_MOCK_INDEX = `
import thingsRouter from './things';
export function registerRoutes(app) { app.use('/api/v1/things', thingsRouter); }
`;

const FIXTURE_MOCK_ROUTER = `
const router = Router();
router.patch('/:id', authGuard, (req, res) => {});
router.post('/:id/archive', authGuard, (req, res) => {});
router.post('/secure', authGuard, (req, res) => {});
export default router;
`;

function policy(overrides: Partial<Policy>): Policy {
  return {
    access: 'signed-in',
    writes: null,
    stepUp: false,
    countFailuresOnlyWhenBody: false,
    skipMfaEnrolmentGate: false,
    throttle: null,
    ...overrides
  };
}

function selfTest(): void {
  const routes = extractRoutes(
    'fixture/things.controller.ts',
    FIXTURE_CONTROLLER
  );
  const files = new Map([
    [path.resolve('fixture/index.ts'), FIXTURE_MOCK_INDEX],
    [path.resolve('fixture/things.ts'), FIXTURE_MOCK_ROUTER]
  ]);
  const mock = parseMockRoutes(path.resolve('fixture/index.ts'), (f) => {
    const text = files.get(f);
    if (text === undefined) throw new Error(`no fixture ${f}`);
    return text;
  });
  const file = 'fixture.json';
  const contract: ContractEntry[] = [
    {
      method: 'PATCH',
      path: '/api/v1/things/1',
      file,
      // Rule 4: the mock route uses authGuard for an update:Thing policy.
      policy: policy({ access: 'update:Thing', writes: 'update:Thing' })
    },
    {
      method: 'POST',
      path: '/api/v1/things/1/archive',
      file,
      // Rule 2: it writes update:Thing, and its access is not update:Thing.
      policy: policy({ writes: 'update:Thing' })
    },
    {
      method: 'POST',
      path: '/api/v1/things/secure',
      file,
      // Rule 1: the contract says stepUp, the handler has no @StepUpRoute.
      // Rule 3: a StepUpFactorsDto body with @Throttle and no @StepUpRoute.
      policy: policy({
        stepUp: true,
        throttle: ['default', 'login-long-window']
      })
    }
  ];

  const problems = evaluate({
    routes,
    contract,
    mock,
    throttleConstants: new Map([
      ['CHALLENGE_THROTTLE', ['default', 'login-long-window']]
    ])
  });

  const expected: [string, string][] = [
    ['[rule 1]', 'POST /api/v1/things/secure'],
    ['[rule 2]', 'POST /api/v1/things/1/archive = signed-in'],
    ['[rule 3]', 'POST /api/v1/things/secure'],
    ['[rule 4]', 'PATCH /api/v1/things/1']
  ];
  const missing = expected.filter(
    ([rule, text]) =>
      !problems.some((p) => p.startsWith(rule) && p.includes(text))
  );
  if (missing.length > 0 || problems.length !== expected.length) {
    console.error('✗ check-route-policy self-test failed. Reported:');
    problems.forEach((p) => console.error(`    ${p}`));
    missing.forEach(([rule, text]) =>
      console.error(`  not reported: ${rule} ${text}`)
    );
    process.exit(1);
  }
  console.log('✓ check-route-policy self-test: all four rules report');
}

// --- main ---

function main(): void {
  const routes = findControllers().flatMap((f) => extractRoutes(f));
  const problems = evaluate({
    routes,
    contract: loadContract(),
    mock: parseMockRoutes(MOCK_INDEX, readFile),
    throttleConstants: objectConstants(readFile(THROTTLE_CONSTANTS))
  });

  if (problems.length === 0) {
    console.log(`✓ Route policies match the code (${routes.length} routes)`);
    return;
  }
  console.error('✗ Route policy drift:\n');
  problems.forEach((p) => console.error(`  ${p}`));
  console.error(
    '\n  → Make each "policy" in contracts/routes/*.json equal the decorators of its handler and its mock-server route.\n'
  );
  process.exit(1);
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) selfTest();
  else main();
}
