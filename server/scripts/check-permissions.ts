/**
 * Verifies that the actions a resource offers in the permission matrix are the
 * actions that the code checks.
 *
 * Fails on:
 *  - a subject used in @Authorize with no matching @RegisterResource
 *  - two resources with one subject
 *  - an @Authorize, client or mock-server check on a reserved CASL action
 *    ('manage', 'all'): only a super role satisfies it, so every grant of the
 *    resource gives nothing
 *  - a @RegisterResource `actions` list that differs from the set of actions
 *    its subject is checked with in @Authorize: an extra entry is a matrix
 *    checkbox that grants nothing, a missing one is a check no role can pass
 *  - a `conditionalActions` entry missing from `actions`
 *  - a declared action with no `rbacActions.<name>` label in a client
 *    translation file: the permission matrix would show a raw key
 *  - a client or mock-server check on an action/subject pair that the
 *    resource does not declare: the UI or the mock then disagrees with the API
 *
 * Client and mock-server checks are found by pattern, so only literal
 * `permissionGuard('a', 'S')` and `{ action: 'a', subject: 'S' }` forms count.
 *
 * Usage (from server/): npm run check:permissions
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// ─── config ──────────────────────────────────────────────────────────────────

const CONTROLLERS_ROOT = path.resolve(__dirname, '../src/modules');
const REPO_ROOT = path.resolve(__dirname, '../..');

/** Source roots whose permission checks must match the server's. */
const CHECK_ROOTS = [
  path.join(REPO_ROOT, 'client/src/app'),
  path.join(REPO_ROOT, 'mock-server/src')
];

/** Controller subdirectories to skip entirely. */
const EXCLUDE_DIRS = new Set(['feature']);

const ACTION_LABEL_FILES = ['en', 'ru'].map((lang) =>
  path.join(REPO_ROOT, `client/src/assets/i18n/${lang}.json`)
);

/** Kept in step with CASL_RESERVED_ACTION_NAMES in src/modules/auth/casl. */
const RESERVED_ACTIONS = new Set(['manage', 'all']);

const CHECK_PATTERNS = [
  /permissionGuard\(\s*'([\w-]+)'\s*,\s*'(\w+)'\s*\)/g,
  /action:\s*'([\w-]+)'\s*,\s*subject:\s*'(\w+)'/g
];

// ─── types ───────────────────────────────────────────────────────────────────

interface RegisteredResource {
  name: string;
  subject: string;
  actions: string[] | undefined;
  conditionalActions: string[] | undefined;
  file: string;
}

interface CodeCheck {
  action: string;
  subject: string;
  location: string;
}

interface AuthorizeUsage {
  action: string;
  subject: string;
  file: string;
}

// ─── AST helpers ─────────────────────────────────────────────────────────────

function decoratorName(d: ts.Decorator): string | undefined {
  const expr = d.expression;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text;
  }
  return ts.isIdentifier(expr) ? expr.text : undefined;
}

function decoratorArgs(
  d: ts.Decorator
): ts.NodeArray<ts.Expression> | undefined {
  return ts.isCallExpression(d.expression) ? d.expression.arguments : undefined;
}

function stringLiteral(node: ts.Expression): string | undefined {
  return ts.isStringLiteral(node) ? node.text : undefined;
}

function stringArray(node: ts.Expression): string[] | undefined {
  if (!ts.isArrayLiteralExpression(node)) return undefined;
  return node.elements
    .map(stringLiteral)
    .filter((a): a is string => a !== undefined);
}

/**
 * Extract { name, subject, actions, conditionalActions } from
 * @RegisterResource({ name: '...', subject: '...', actions: [...], ... })
 */
function parseRegisterResource(
  d: ts.Decorator
): Omit<RegisteredResource, 'file'> | undefined {
  const args = decoratorArgs(d);
  if (!args?.length) return undefined;

  const arg = args[0];
  if (!ts.isObjectLiteralExpression(arg)) return undefined;

  let name: string | undefined;
  let subject: string | undefined;
  let actions: string[] | undefined;
  let conditionalActions: string[] | undefined;

  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    if (prop.name.text === 'name') name = stringLiteral(prop.initializer);
    if (prop.name.text === 'subject') subject = stringLiteral(prop.initializer);
    if (prop.name.text === 'actions') actions = stringArray(prop.initializer);
    if (prop.name.text === 'conditionalActions') {
      conditionalActions = stringArray(prop.initializer);
    }
  }

  return name && subject
    ? { name, subject, actions, conditionalActions }
    : undefined;
}

/**
 * Extract all [action, Subject] pairs from @Authorize(['action', 'Subject'], ...)
 */
function parseAuthorize(
  d: ts.Decorator
): Array<{ action: string; subject: string }> {
  const args = decoratorArgs(d);
  if (!args?.length) return [];

  const results: Array<{ action: string; subject: string }> = [];

  for (const arg of args) {
    if (!ts.isArrayLiteralExpression(arg)) continue;
    if (arg.elements.length < 2) continue;

    const action = stringLiteral(arg.elements[0]);
    const subject = stringLiteral(arg.elements[1]);
    if (action && subject) {
      results.push({ action, subject });
    }
  }

  return results;
}

// ─── file scanning ────────────────────────────────────────────────────────────

function findControllers(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry.name)) {
        results.push(...findControllers(path.join(dir, entry.name)));
      }
    } else if (entry.name.endsWith('.controller.ts')) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

function scanFile(filePath: string): {
  resources: RegisteredResource[];
  authorizeUsages: AuthorizeUsage[];
} {
  const source = fs.readFileSync(filePath, 'utf-8');
  const sf = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true
  );

  const relPath = path.relative(CONTROLLERS_ROOT, filePath);
  const resources: RegisteredResource[] = [];
  const authorizeUsages: AuthorizeUsage[] = [];

  ts.forEachChild(sf, (node) => {
    if (!ts.isClassDeclaration(node)) return;

    const classDecorators = ts.getDecorators(node);
    if (classDecorators) {
      for (const d of classDecorators) {
        if (decoratorName(d) === 'RegisterResource') {
          const parsed = parseRegisterResource(d);
          if (parsed) {
            resources.push({ ...parsed, file: relPath });
          }
        }
      }
    }

    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member)) continue;

      const methodDecorators = ts.getDecorators(member);
      if (!methodDecorators) continue;

      for (const d of methodDecorators) {
        if (decoratorName(d) === 'Authorize') {
          const usages = parseAuthorize(d);
          for (const u of usages) {
            authorizeUsages.push({ ...u, file: relPath });
          }
        }
      }
    }
  });

  return { resources, authorizeUsages };
}

function findSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') results.push(...findSourceFiles(full));
    } else if (
      /\.(ts|html)$/.test(entry.name) &&
      !/\.spec\.ts$/.test(entry.name)
    ) {
      results.push(full);
    }
  }
  return results;
}

function scanCodeChecks(filePath: string): CodeCheck[] {
  const source = fs.readFileSync(filePath, 'utf-8');
  const relPath = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
  const checks: CodeCheck[] = [];
  for (const pattern of CHECK_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split('\n').length;
      checks.push({
        action: match[1],
        subject: match[2],
        location: `${relPath}:${line}`
      });
    }
  }
  return checks;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

// ─── main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const controllerFiles = findControllers(CONTROLLERS_ROOT);

  const allResources: RegisteredResource[] = [];
  const allAuthorizeUsages: AuthorizeUsage[] = [];

  for (const file of controllerFiles) {
    const { resources, authorizeUsages } = scanFile(file);
    allResources.push(...resources);
    allAuthorizeUsages.push(...authorizeUsages);
  }

  // Build lookup: subject → resource
  const subjectToResource = new Map<string, RegisteredResource>();
  const errors: string[] = [];
  for (const r of allResources) {
    const clash = subjectToResource.get(r.subject);
    if (clash) {
      // The DB enforces UQ_resources_subject; without this check the collision
      // would only surface as a failed migration or a failed bootstrap sync.
      errors.push(
        `  ${r.file}: subject "${r.subject}" is already registered by resource "${clash.name}" in ${clash.file} — CASL cannot resolve an ambiguous subject`
      );
      continue;
    }
    subjectToResource.set(r.subject, r);
  }

  // subject -> actions it is checked with in @Authorize
  const checkedActions = new Map<string, Set<string>>();

  for (const usage of allAuthorizeUsages) {
    if (RESERVED_ACTIONS.has(usage.action)) {
      errors.push(
        `  ${usage.file}: @Authorize(['${usage.action}', '${usage.subject}']) — "${usage.action}" is a reserved CASL action that only a super role passes; check an ordinary action instead`
      );
    }
    if (!subjectToResource.has(usage.subject)) {
      errors.push(
        `  ${usage.file}: @Authorize(['${usage.action}', '${usage.subject}']) — subject "${usage.subject}" has no matching @RegisterResource`
      );
    }
    const actions = checkedActions.get(usage.subject) ?? new Set<string>();
    actions.add(usage.action);
    checkedActions.set(usage.subject, actions);
  }

  for (const r of subjectToResource.values()) {
    if (!r.actions) {
      errors.push(
        `  ${r.file}: @RegisterResource "${r.name}" has no literal \`actions\` list`
      );
      continue;
    }
    if (!r.conditionalActions) {
      errors.push(
        `  ${r.file}: @RegisterResource "${r.name}" has no literal \`conditionalActions\` list`
      );
    } else {
      for (const action of r.conditionalActions) {
        if (!r.actions.includes(action)) {
          errors.push(
            `  ${r.file}: @RegisterResource "${r.name}" lists "${action}" in conditionalActions but not in actions`
          );
        }
      }
    }
    const declared = new Set(r.actions);
    const checked = checkedActions.get(r.subject) ?? new Set<string>();
    if (!sameSet(declared, checked)) {
      errors.push(
        `  ${r.file}: @RegisterResource "${r.name}" declares actions [${[...declared].sort().join(', ')}], but @Authorize checks "${r.subject}" with [${[...checked].sort().join(', ')}]`
      );
    }
  }

  const declaredActions = new Set(allResources.flatMap((r) => r.actions ?? []));
  for (const file of ACTION_LABEL_FILES) {
    const labels = (
      JSON.parse(fs.readFileSync(file, 'utf-8')) as {
        rbacActions?: Record<string, unknown>;
      }
    ).rbacActions;
    for (const action of declaredActions) {
      if (typeof labels?.[action] !== 'string') {
        errors.push(
          `  ${path.relative(REPO_ROOT, file)}: no label rbacActions.${action} for a declared action`
        );
      }
    }
  }

  const codeChecks = CHECK_ROOTS.flatMap((root) =>
    findSourceFiles(root).flatMap(scanCodeChecks)
  );
  for (const check of codeChecks) {
    const label = `'${check.action}' on '${check.subject}'`;
    if (RESERVED_ACTIONS.has(check.action)) {
      errors.push(
        `  ${check.location}: check of ${label} — "${check.action}" is a reserved CASL action that only a super role passes`
      );
      continue;
    }
    const resource = subjectToResource.get(check.subject);
    if (!resource) {
      errors.push(
        `  ${check.location}: check of ${label} — no @RegisterResource has subject "${check.subject}"`
      );
    } else if (!resource.actions?.includes(check.action)) {
      errors.push(
        `  ${check.location}: check of ${label} — resource "${resource.name}" does not declare action "${check.action}"`
      );
    }
  }

  if (errors.length > 0) {
    console.error(
      `✗ check:permissions found ${errors.length} issue${errors.length === 1 ? '' : 's'}:\n`
    );
    errors.forEach((e) => console.error(e));
    console.error(
      '\n  → Make each @RegisterResource `actions` list equal the actions its @Authorize decorators check, and make client and mock-server checks use only those actions.\n'
    );
    process.exit(1);
  }

  console.log(
    `✓ Resource actions match their checks (${allResources.length} resources, ${allAuthorizeUsages.length} @Authorize usages, ${codeChecks.length} client and mock-server checks)`
  );
}

main();
