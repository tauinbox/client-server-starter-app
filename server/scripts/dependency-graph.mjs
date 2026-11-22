/**
 * Draws the import graph of the repository from the source files.
 *
 * `npm run graph` writes `architecture/dependency-graph.md`: Mermaid views of
 * the workspaces and of the modules of the server, the client and the mock
 * server. `npm run graph:check` (CI, `Repo - Checks`) fails when that file
 * differs from the graph of the current tree.
 *
 * `npm run graph -- --html` also writes an interactive page for each view, and
 * a page for each module (its files, and the modules that it imports or that
 * import it), into the gitignored `architecture/html/`. It needs the Graphviz `dot`
 * program.
 * `--focus <regex>` draws one file-level page with only the modules that match
 * the regex and their direct neighbours.
 *
 * The input is the list of files that git tracks, so a generated file that
 * exists on one machine only does not change the graph.
 */

import { cruise, format } from 'dependency-cruiser';
import extractTSConfig from 'dependency-cruiser/config-utl/extract-ts-config';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_MD = 'architecture/dependency-graph.md';
const OUT_HTML = 'architecture/html';
const TS_CONFIG = 'client/tsconfig.json';
const SOURCE_DIRS = [
  'client/src',
  'client/e2e',
  'server/src',
  'mock-server/src',
  'shared/src'
];
const SKIP = /\.spec\.ts$|\.d\.ts$/;
const SOURCES = `^(${SOURCE_DIRS.join('|')})/`;
const MIN_MODULES = 300;
const SHARED_CONSUMERS = ['client/src', 'server/src', 'mock-server/src'];
const WINDOWS_GRAPHVIZ = String.raw`C:\Program Files\Graphviz\bin`;

const VIEWS = [
  {
    id: 'workspaces',
    title: 'Workspaces',
    text: 'Each node is one source root. An arrow is at least one import.',
    includeOnly: SOURCES,
    collapse: '^(client/src|client/e2e|server/src|mock-server/src|shared/src)'
  },
  {
    id: 'server-modules',
    title: 'Server modules',
    text: 'Each folder of `server/src/modules` is one node, so an arrow is any import between two folders: an entity relation, a decorator, a service. `core.module.ts` is the composition root and has its own node. The other files of `core/` are shared infrastructure. The Nest module graph is the next view.',
    includeOnly: '^(server/src|shared/src)/',
    collapse:
      '^(server/src/modules/core/core[.]module[.]ts|server/src/modules/[^/]+|server/src/[^/]+|shared/src/[^/]+)'
  },
  {
    id: 'server-nest-modules',
    title: 'Server Nest modules',
    text: 'Each `*.module.ts` file is one node, and an arrow is an import between two module files. Two folders can import each other while their Nest modules do not: for example `AuthModule` imports `UsersModule`, and `UsersApiModule` imports `AuthModule`.',
    includeOnly: '^server/src/.*[.]module[.]ts$'
  },
  {
    id: 'client-modules',
    title: 'Client modules',
    text: 'Each feature folder is one node.',
    includeOnly: '^(client/src|shared/src)/',
    collapse:
      '^(client/src/app/features/[^/]+|client/src/app/[^/]+|client/src/[^/]+|shared/src/[^/]+)'
  },
  {
    id: 'mock-server-modules',
    title: 'Mock server modules',
    text: 'Each top-level folder or file of `mock-server/src` is one node.',
    includeOnly: '^(mock-server/src|shared/src)/',
    collapse: '^(mock-server/src/[^/]+|shared/src/[^/]+)'
  }
];

const MODULE_SOURCE =
  'server/src/modules/[^/]+|client/src/app/features/[^/]+|client/src/app/(?:core|shared)|mock-server/src/[^/]+|shared/src/[^/]+';
const MODULE_DIR = new RegExp(`^(${MODULE_SOURCE})/`);
const OTHER_FILES = 'server/src/[^/]+|client/src/[^/]+|client/e2e';

function trackedSources() {
  const out = execFileSync('git', ['ls-files', '--', ...SOURCE_DIRS], {
    cwd: ROOT,
    encoding: 'utf8'
  });

  return out
    .split('\n')
    .filter((file) => file.endsWith('.ts') && !SKIP.test(file));
}

async function cruiseRepo() {
  const result = await cruise(
    trackedSources(),
    {
      includeOnly: SOURCES,
      doNotFollow: { path: 'node_modules' },
      tsPreCompilationDeps: true,
      tsConfig: { fileName: TS_CONFIG }
    },
    {},
    { tsConfig: extractTSConfig(TS_CONFIG) }
  );

  const { output } = result;
  const local = output.modules.filter(
    ({ source }) => !source.includes('node_modules')
  );

  // dependency-cruiser finds no TypeScript module, and reports no error, when
  // no supported TypeScript compiler is installed.
  if (local.length < MIN_MODULES) {
    console.error(
      `graph: found only ${local.length} source modules. Check that the TypeScript version of server/ is one that dependency-cruiser supports.`
    );
    process.exit(1);
  }

  // A broken path alias drops every edge to shared/ and reports no error.
  const unlinked = SHARED_CONSUMERS.filter(
    (root) =>
      !local.some(
        ({ source, dependencies }) =>
          source.startsWith(`${root}/`) &&
          dependencies.some(({ resolved }) =>
            resolved.startsWith('shared/src/')
          )
      )
  );

  if (unlinked.length > 0) {
    console.error(
      `graph: no import from ${unlinked.join(', ')} resolves into shared/src. Check the @app/shared alias of ${TS_CONFIG}.`
    );
    process.exit(1);
  }

  return output;
}

async function render(result, options) {
  const { output } = await format(result, options);

  return output.replaceAll('\r\n', '\n').trimEnd();
}

function splitView({ id, title, text, ...filters }) {
  return { id, title, text, filters };
}

async function markdown(result) {
  const parts = [
    '# Dependency graph',
    '',
    'Generated by `npm run graph` (from `server/`) from the imports of the files that git tracks. Do not edit this file. CI runs `npm run graph:check` and fails when the file is out of date.',
    '',
    'Spec files are not in the graph. An HTTP call from the client to the server is not an import, so it is not in the graph: `contracts/routes.json` lists the routes.',
    '',
    'For an interactive file-level view, run `npm run graph -- --html` (needs Graphviz) and open the pages in `architecture/html/`.'
  ];

  for (const { title, text, filters } of VIEWS.map(splitView)) {
    const graph = await render(result, { outputType: 'mermaid', ...filters });

    parts.push('', `## ${title}`, '', text, '', '```mermaid', graph, '```');
  }

  return `${parts.join('\n')}\n`;
}

function ensureDot() {
  if (spawnSync('dot', ['-V']).status === 0) return;

  if (existsSync(join(WINDOWS_GRAPHVIZ, 'dot.exe'))) {
    process.env.PATH = `${WINDOWS_GRAPHVIZ}${delimiter}${process.env.PATH}`;

    return;
  }

  console.error(
    'graph: the Graphviz `dot` program is not on PATH. Install Graphviz (https://graphviz.org/download) and run the command again.'
  );
  process.exit(1);
}

// Graphviz can stop with "trouble in init_rank" on a large graph with folder
// clusters. Without cluster ranking the same graph renders, but the folders
// lose their boxes, so that mode is a fallback only.
async function renderPage(result, { id, filters }) {
  const options = { outputType: 'x-dot-webpage', ...filters };

  try {
    return await render(result, options);
  } catch {
    console.warn(
      `graph: ${id}: Graphviz failed, drawing again without folder boxes.`
    );
  }

  const { optionsUsed: used } = result.summary;
  const { reporterOptions: saved } = used;

  used.reporterOptions = {
    ...saved,
    dot: { theme: { graph: { clusterrank: 'none' } } }
  };

  try {
    return await render(result, options);
  } finally {
    used.reporterOptions = saved;
  }
}

async function writeHtml(result, focus) {
  ensureDot();
  mkdirSync(join(ROOT, OUT_HTML), { recursive: true });

  const moduleDirs = new Set(
    result.modules
      .map(({ source }) => MODULE_DIR.exec(source)?.[1])
      .filter(Boolean)
  );
  const pages = [
    ...VIEWS.map(splitView).map(({ id, filters }) => ({ id, ...filters })),
    ...[...moduleDirs].toSorted().map((dir) => ({
      id: `module--${dir.replaceAll('/', '--')}`,
      includeOnly: SOURCES,
      focus: `^${dir}/`,
      collapse: `^(?!${dir}/)(${MODULE_SOURCE}|${OTHER_FILES})`
    }))
  ];

  if (focus) pages.push({ id: 'focus', includeOnly: SOURCES, focus });

  for (const { id, ...filters } of pages) {
    const html = await renderPage(result, { id, filters });

    writeFileSync(join(ROOT, OUT_HTML, `${id}.html`), `${html}\n`);
    console.log(`graph: wrote ${OUT_HTML}/${id}.html`);
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name);

  return index === -1 ? undefined : process.argv[index + 1];
}

process.chdir(ROOT);

const result = await cruiseRepo();
const expected = await markdown(result);
const target = join(ROOT, OUT_MD);

if (process.argv.includes('--check')) {
  const actual = existsSync(target)
    ? readFileSync(target, 'utf8').replaceAll('\r\n', '\n')
    : '';

  if (actual !== expected) {
    console.error(
      `graph: ${OUT_MD} is out of date. Run \`npm run graph\` from server/ and commit the file.`
    );
    process.exit(1);
  }

  console.log(`graph: ${OUT_MD} is up to date.`);
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, expected);
  console.log(`graph: wrote ${OUT_MD}`);

  if (process.argv.includes('--html') || argValue('--focus')) {
    await writeHtml(result, argValue('--focus'));
  }
}
