/**
 * Reads the routes of the server controllers from their source: the
 * `@Controller` path and version, the HTTP-method decorator, and the
 * decorators of the handler and of its class. `check:routes` and
 * `check:route-policy` both use it, so the two checks see the same route set.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const GLOBAL_PREFIX = 'api';
export const CONTROLLERS_ROOT = path.resolve(__dirname, '../../src/modules');

/** Controller subdirectories to skip entirely. */
const EXCLUDE_DIRS = new Set(['feature']);

/**
 * Controller files whose routes are NOT part of the public API contract.
 * Prometheus scrape endpoint is registered dynamically by `PrometheusModule`
 * outside the `/api` prefix and is intentionally absent from `routes.json`.
 */
const EXCLUDE_FILES = new Set(['metrics.controller.ts']);

/**
 * Default param -> sample-value substitutions.
 * Applied to every controller unless overridden below.
 */
const DEFAULT_PARAMS: Record<string, string> = {
  ':id': '1',
  ':userId': '1',
  ':roleId': 'role-admin',
  ':permissionId': 'perm-1',
  ':sessionId': '1',
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

export interface ControllerRoute {
  method: string;
  path: string;
  file: string;
  handler: string;
  decorators: readonly ts.Decorator[];
  classDecorators: readonly ts.Decorator[];
  /** The type name of the `@Body()` parameter, if the handler has one. */
  bodyType: string | undefined;
}

export function decoratorName(d: ts.Decorator): string | undefined {
  const expr = d.expression;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text;
  }
  return ts.isIdentifier(expr) ? expr.text : undefined;
}

export function decoratorArgs(
  d: ts.Decorator
): ts.NodeArray<ts.Expression> | undefined {
  return ts.isCallExpression(d.expression) ? d.expression.arguments : undefined;
}

function stringLiteral(node: ts.Expression): string | undefined {
  return ts.isStringLiteral(node) ? node.text : undefined;
}

function parseControllerArgs(d: ts.Decorator): {
  controllerPath: string;
  version: string | null;
} {
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

function bodyTypeOf(member: ts.MethodDeclaration): string | undefined {
  for (const param of member.parameters) {
    const isBody = ts
      .getDecorators(param)
      ?.some((d) => decoratorName(d) === 'Body');
    if (
      isBody &&
      param.type &&
      ts.isTypeReferenceNode(param.type) &&
      ts.isIdentifier(param.type.typeName)
    ) {
      return param.type.typeName.text;
    }
  }
  return undefined;
}

export function findControllers(dir: string = CONTROLLERS_ROOT): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry.name)) {
        results.push(...findControllers(path.join(dir, entry.name)));
      }
    } else if (
      entry.name.endsWith('.controller.ts') &&
      !EXCLUDE_FILES.has(entry.name)
    ) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

export function extractRoutes(
  filePath: string,
  source: string = fs.readFileSync(filePath, 'utf-8')
): ControllerRoute[] {
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

  const routes: ControllerRoute[] = [];

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

        routes.push({
          method: httpMethod.toUpperCase(),
          path: fullPath,
          file: filePath,
          handler: member.name.getText(sf),
          decorators: methodDecorators,
          classDecorators,
          bodyType: bodyTypeOf(member)
        });
        break; // one HTTP method per handler
      }
    }
  });

  return routes;
}
