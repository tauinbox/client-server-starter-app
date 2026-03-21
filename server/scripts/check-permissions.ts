/**
 * Verifies that @Authorize usages reference subjects that are actually registered
 * via @RegisterResource decorators.
 *
 * Catches the class of bug where a developer adds @Authorize(['read', 'Foo'])
 * but either forgets to add @RegisterResource to the controller or misspells the
 * subject name — causing silent permission bypass at runtime.
 *
 * Reports:
 *  - Subjects used in @Authorize with no matching @RegisterResource
 *  - Resources registered via @RegisterResource but never referenced in any @Authorize
 *
 * Usage (from server/): npm run check:permissions
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// ─── config ──────────────────────────────────────────────────────────────────

const CONTROLLERS_ROOT = path.resolve(__dirname, '../src/modules');

/** Controller subdirectories to skip entirely. */
const EXCLUDE_DIRS = new Set(['feature']);

// ─── types ───────────────────────────────────────────────────────────────────

interface RegisteredResource {
  name: string;
  subject: string;
  file: string;
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

/**
 * Extract { name, subject } from @RegisterResource({ name: '...', subject: '...' })
 */
function parseRegisterResource(d: ts.Decorator): { name: string; subject: string } | undefined {
  const args = decoratorArgs(d);
  if (!args?.length) return undefined;

  const arg = args[0];
  if (!ts.isObjectLiteralExpression(arg)) return undefined;

  let name: string | undefined;
  let subject: string | undefined;

  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    if (prop.name.text === 'name') name = stringLiteral(prop.initializer);
    if (prop.name.text === 'subject') subject = stringLiteral(prop.initializer);
  }

  return name && subject ? { name, subject } : undefined;
}

/**
 * Extract all [action, Subject] pairs from @Authorize(['action', 'Subject'], ...)
 */
function parseAuthorize(d: ts.Decorator): Array<{ action: string; subject: string }> {
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
  for (const r of allResources) {
    subjectToResource.set(r.subject, r);
  }

  // Track which registered subjects are actually used in @Authorize
  const usedSubjects = new Set<string>();
  const errors: string[] = [];

  for (const usage of allAuthorizeUsages) {
    usedSubjects.add(usage.subject);
    if (!subjectToResource.has(usage.subject)) {
      errors.push(
        `  ${usage.file}: @Authorize(['${usage.action}', '${usage.subject}']) — subject "${usage.subject}" has no matching @RegisterResource`
      );
    }
  }

  // Registered subjects never used in @Authorize (informational warning)
  const unusedResources = allResources.filter((r) => !usedSubjects.has(r.subject));

  if (errors.length > 0) {
    console.error(`✗ check:permissions found ${errors.length} issue${errors.length === 1 ? '' : 's'}:\n`);
    errors.forEach((e) => console.error(e));
    console.error(
      '\n  → Either add @RegisterResource to the controller for that subject, or fix the subject name in @Authorize.\n'
    );
    process.exit(1);
  }

  console.log(
    `✓ All @Authorize usages reference registered resources (${allResources.length} registered, ${allAuthorizeUsages.length} usages checked)`
  );

  if (unusedResources.length > 0) {
    console.warn(`\n  ⚠ Resources registered but never referenced in @Authorize:`);
    for (const r of unusedResources) {
      console.warn(`    "${r.subject}" (${r.name}) in ${r.file}`);
    }
    console.warn('  → These may be intentional (resources protected by role-level guards or super-admin only).\n');
  }
}

main();
