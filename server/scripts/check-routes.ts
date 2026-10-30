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
import { extractRoutes, findControllers } from './lib/controller-routes';

// ─── config ──────────────────────────────────────────────────────────────────

const CONTRACTS_ROOT = path.resolve(__dirname, '../../contracts');
const ROUTES_INDEX = path.join(CONTRACTS_ROOT, 'routes.json');
const ROUTES_DIR = path.join(CONTRACTS_ROOT, 'routes');
const SERVER_PKG = path.resolve(__dirname, '../package.json');

// ─── types ───────────────────────────────────────────────────────────────────

interface RouteEntry {
  method: string;
  path: string;
}

// ─── main ─────────────────────────────────────────────────────────────────────

function routeKey(r: RouteEntry): string {
  return `${r.method} ${r.path}`;
}

/**
 * Loads all manifest routes by flattening every per-feature file under
 * contracts/routes/. Adding a new feature means dropping a new JSON file there —
 * no edit to routes.json or this loader is required.
 */
function loadManifestRoutes(): RouteEntry[] {
  return fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => {
      const { routes } = JSON.parse(
        fs.readFileSync(path.join(ROUTES_DIR, f), 'utf-8')
      ) as { routes: RouteEntry[] };
      return routes;
    });
}

function main(): void {
  const serverRoutes = findControllers().flatMap((file) => extractRoutes(file));
  const serverSet = new Set(serverRoutes.map(routeKey));

  const manifest = {
    version: (
      JSON.parse(fs.readFileSync(ROUTES_INDEX, 'utf-8')) as { version: string }
    ).version,
    routes: loadManifestRoutes()
  };
  const serverVersion = (
    JSON.parse(fs.readFileSync(SERVER_PKG, 'utf-8')) as { version: string }
  ).version;

  if (manifest.version !== serverVersion) {
    console.error(
      `✗ contracts/routes.json version mismatch: manifest is ${manifest.version}, server is ${serverVersion}\n` +
        `  → Update "version" in contracts/routes.json to "${serverVersion}"\n`
    );
    process.exit(1);
  }

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
