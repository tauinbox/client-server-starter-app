/**
 * Verifies that contracts/routes.json is in sync with server controllers.
 *
 * Extracts all routes from @Controller + HTTP-method decorators, substitutes
 * route params with sample values, and compares against the manifest.
 * Exits with code 1 and a diff when routes are missing or stale.
 *
 * Usage (from server/): npm run check:routes
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// ─── config ──────────────────────────────────────────────────────────────────

const GLOBAL_PREFIX = 'api';
const CONTROLLERS_ROOT = path.resolve(__dirname, '../src/modules');
const ROUTES_MANIFEST = path.resolve(__dirname, '../../contracts/routes.json');

/** Controller subdirectories to skip entirely. */
const EXCLUDE_DIRS = new Set(['feature']);

/**
 * Default param → sample-value substitutions.
 * Applied to every controller unless overridden below.
 */
const DEFAULT_PARAMS: Record<string, string> = {
  ':id': '1',
  ':userId': '1',
  ':roleId': 'role-admin',
  ':permissionId': 'perm-1',
  ':provider': 'google'
};

/**
 * Per-controller overrides keyed by filename (basename).
 * Use when the same :id means different things in different controllers.
 */
const CONTROLLER_PARAM_OVERRIDES: Record<string, Record<string, string>> = {
  // In RolesController, :id is a role ID, not a user ID.
  'roles.controller.ts': { ':id': 'role-admin' }
};

const HTTP_METHODS = ['Get', 'Post', 'Patch', 'Delete', 'Put'] as const;

// ─── types ───────────────────────────────────────────────────────────────────

interface RouteEntry {
  method: string;
  path: string;
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

function parseControllerArgs(
  d: ts.Decorator
): { controllerPath: string; version: string | null } {
  const args = decoratorArgs(d);
  if (!args?.length) return { controllerPath: '', version: null };

  const arg = args[0];

  // @Controller('path')
  if (ts.isStringLiteral(arg)) {
    return { controllerPath: arg.text, version: null };
  }

  // @Controller({ path: 'path', version: '1' })
  if (ts.isObjectLiteralExpression(arg)) {
    let controllerPath = '';
    let version: string | null = null;
    for (const prop of arg.properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
        continue;
      }
      if (prop.name.text === 'path') {
        controllerPath = stringLiteral(prop.initializer) ?? '';
      }
      if (prop.name.text === 'version') {
        version = stringLiteral(prop.initializer) ?? null;
      }
    }
    return { controllerPath, version };
  }

  return { controllerPath: '', version: null };
}

function parseMethodPath(d: ts.Decorator): string {
  const args = decoratorArgs(d);
  if (!args?.length) return '';
  return stringLiteral(args[0]) ?? '';
}

function substituteParams(
  routePath: string,
  params: Record<string, string>
): string {
  return routePath.replace(/:(\w+)/g, (_, name: string) => {
    return params[`:${name}`] ?? name;
  });
}

// ─── controller scanning ─────────────────────────────────────────────────────

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

function extractRoutes(filePath: string): RouteEntry[] {
  const source = fs.readFileSync(filePath, 'utf-8');
  const sf = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true
  );

  const filename = path.basename(filePath);
  const params: Record<string, string> = {
    ...DEFAULT_PARAMS,
    ...(CONTROLLER_PARAM_OVERRIDES[filename] ?? {})
  };

  const routes: RouteEntry[] = [];

  ts.forEachChild(sf, (node) => {
    if (!ts.isClassDeclaration(node)) return;

    const classDecorators = ts.getDecorators(node);
    if (!classDecorators) return;

    const controllerDec = classDecorators.find(
      (d) => decoratorName(d) === 'Controller'
    );
    if (!controllerDec) return;

    const { controllerPath, version } = parseControllerArgs(controllerDec);
    const versionSegment = version ? `v${version}` : null;
    const basePath = [GLOBAL_PREFIX, versionSegment, controllerPath]
      .filter(Boolean)
      .join('/');

    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member)) continue;

      const methodDecorators = ts.getDecorators(member);
      if (!methodDecorators) continue;

      for (const httpMethod of HTTP_METHODS) {
        const httpDec = methodDecorators.find(
          (d) => decoratorName(d) === httpMethod
        );
        if (!httpDec) continue;

        // Strip leading slash so joining works correctly in all cases.
        const rawMethodPath = parseMethodPath(httpDec).replace(/^\//, '');
        const segments = [basePath, rawMethodPath].filter(Boolean);
        const fullPath = substituteParams('/' + segments.join('/'), params);

        routes.push({ method: httpMethod.toUpperCase(), path: fullPath });
        break; // one HTTP method per handler
      }
    }
  });

  return routes;
}

// ─── main ─────────────────────────────────────────────────────────────────────

function routeKey(r: RouteEntry): string {
  return `${r.method} ${r.path}`;
}

function main(): void {
  const controllerFiles = findControllers(CONTROLLERS_ROOT);
  const serverRoutes = controllerFiles.flatMap(extractRoutes);
  const serverSet = new Set(serverRoutes.map(routeKey));

  const manifest = JSON.parse(
    fs.readFileSync(ROUTES_MANIFEST, 'utf-8')
  ) as { routes: RouteEntry[] };
  const manifestSet = new Set(manifest.routes.map(routeKey));

  const missing = [...serverSet].filter((k) => !manifestSet.has(k));
  const extra = [...manifestSet].filter((k) => !serverSet.has(k));

  if (missing.length === 0 && extra.length === 0) {
    console.log(
      `✓ contracts/routes.json is in sync (${serverRoutes.length} routes)`
    );
    return;
  }

  console.error('✗ Contract drift detected in contracts/routes.json:\n');

  if (missing.length > 0) {
    console.error('  In server but MISSING from routes.json:');
    missing.forEach((r) => console.error(`    + ${r}`));
    console.error(
      '\n  → Add these to contracts/routes.json with the correct expectedStatus.\n'
    );
  }

  if (extra.length > 0) {
    console.error('  In routes.json but NOT FOUND in server:');
    extra.forEach((r) => console.error(`    - ${r}`));
    console.error('\n  → Remove these from contracts/routes.json.\n');
  }

  process.exit(1);
}

main();
