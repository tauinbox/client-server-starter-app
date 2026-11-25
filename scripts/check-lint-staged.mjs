/**
 * Pre-commit coverage check. The pre-commit hook runs lint-staged from the
 * repository root; the CI gates run `lint`, `lint:styles`, `lint:shared`,
 * `lint:scripts` and `format:check` of each workspace. A file that a gate
 * reads and that no lint-staged entry passes to the same tool is found only
 * by CI, minutes later.
 *
 * Default mode (zero dependencies): each tracked file that a gate reads has a
 * lint-staged entry that runs the tool of that gate on it.
 *
 * `--eslint <workspace>`: for each file that lint-staged passes to ESLint with
 * a config of that workspace, the rules that ESLint calculates from the root
 * (the pre-commit run) equal the rules of the gate from its own directory. A
 * config block with a relative `files` pattern and no `basePath` gives other
 * rules from the root. Needs the ESLint of that workspace, so each CI job runs
 * it for the workspace that it installs.
 *
 * `--self-test` runs the detectors against synthetic input and fails if they
 * stay silent.
 *
 * Exit code 1 on a finding.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACES = ['client', 'mock-server', 'server'];
const GATE_SCRIPTS = [
  'lint',
  'lint:styles',
  'lint:shared',
  'lint:scripts',
  'format:check'
];
const TOOLS = ['eslint', 'prettier', 'stylelint'];
const CONFIG_NAMES = [
  'eslint.config.ts',
  'eslint.config.mjs',
  'eslint.config.js'
];
const SHOWN_PER_GATE = 10;

const toPosix = (file) => file.split(path.sep).join('/');
const fromRoot = (cwd, file) =>
  toPosix(path.relative(ROOT, path.resolve(cwd, file)));

/** The tool, the quoted globs and the `-c` config of one shell command. */
export function parseCommand(command, cwd) {
  const words = command.trim().split(/\s+/);
  const tool = TOOLS.find((name) => path.basename(words[0] ?? '') === name);

  if (!tool) return null;

  const globs = [...command.matchAll(/"([^"]+)"/g)].map(([, glob]) => glob);
  const flag = words.indexOf('-c');

  return {
    tool,
    globs,
    config: flag === -1 ? null : fromRoot(cwd, words[flag + 1])
  };
}

function defaultEslintConfig(cwd) {
  const name = CONFIG_NAMES.find((file) => existsSync(path.join(cwd, file)));

  return name ? fromRoot(cwd, name) : null;
}

/** Each tool run of the gate scripts of each workspace. */
function readGates() {
  const gates = [];

  for (const workspace of WORKSPACES) {
    const dir = path.join(ROOT, workspace);
    const { scripts = {} } = JSON.parse(
      readFileSync(path.join(dir, 'package.json'), 'utf8')
    );

    for (const name of GATE_SCRIPTS) {
      if (!scripts[name]) continue;

      let cwd = dir;

      for (const segment of scripts[name].split('&&').map((s) => s.trim())) {
        if (/^cd\s+\.\.$/.test(segment)) {
          cwd = ROOT;
          continue;
        }

        const label = `${workspace} ${name}`;

        if (segment.startsWith('ng lint')) {
          const angular = JSON.parse(
            readFileSync(path.join(cwd, 'angular.json'), 'utf8')
          );

          for (const project of Object.values(angular.projects)) {
            const patterns = project.architect?.lint?.options?.lintFilePatterns;

            if (patterns) {
              gates.push({
                label,
                cwd,
                tool: 'eslint',
                globs: patterns,
                config: defaultEslintConfig(cwd)
              });
            }
          }

          continue;
        }

        const parsed = parseCommand(segment, cwd);

        if (!parsed) continue;

        gates.push({
          label,
          cwd,
          ...parsed,
          config:
            parsed.tool === 'eslint'
              ? (parsed.config ?? defaultEslintConfig(cwd))
              : null
        });
      }
    }
  }

  return gates;
}

/** The entries of `.lintstagedrc.mjs` with the tools and the ESLint config of each. */
async function readEntries() {
  const { default: config } = await import(
    pathToFileURL(path.join(ROOT, '.lintstagedrc.mjs')).href
  );

  return Object.entries(config).map(([pattern, task]) => {
    const commands = [task(['FILE'])].flat();
    const tools = TOOLS.filter((tool) =>
      commands.some((command) => parseCommand(command, ROOT)?.tool === tool)
    );
    const eslint = commands
      .map((command) => parseCommand(command, ROOT))
      .find((parsed) => parsed?.tool === 'eslint');

    return { pattern, tools, eslintConfig: eslint?.config ?? null };
  });
}

/** lint-staged matches a pattern with no slash against the base name. */
export function entryMatches(pattern, file) {
  return pattern.includes('/')
    ? path.posix.matchesGlob(file, pattern)
    : path.posix.matchesGlob(path.posix.basename(file), pattern);
}

/** Each file of a gate that no entry passes to the tool of the gate. */
export function findUncovered({ gates, entries }) {
  const findings = [];

  for (const { label, tool, files } of gates) {
    const missing = files.filter(
      (file) =>
        !entries.some(
          ({ pattern, tools }) =>
            tools.includes(tool) && entryMatches(pattern, file)
        )
    );

    if (missing.length > 0) findings.push({ label, tool, missing });
  }

  return findings;
}

/** The names of the rules that differ; `<ignored>` when one side ignores the file. */
export function differingRules(gateRules, stagedRules) {
  if (!gateRules || !stagedRules) {
    return gateRules === stagedRules ? [] : ['<ignored>'];
  }

  const names = new Set([
    ...Object.keys(gateRules),
    ...Object.keys(stagedRules)
  ]);

  return [...names].filter(
    (name) =>
      JSON.stringify(gateRules[name]) !== JSON.stringify(stagedRules[name])
  );
}

function trackedFiles() {
  return new Set(
    execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
  );
}

function gateFiles(gate, tracked) {
  const files = new Set();

  for (const glob of gate.globs) {
    for (const match of globSync(glob, { cwd: gate.cwd })) {
      const file = fromRoot(gate.cwd, match);

      if (tracked.has(file)) files.add(file);
    }
  }

  return [...files].toSorted();
}

async function checkCoverage() {
  const tracked = trackedFiles();
  const entries = await readEntries();
  const gates = readGates().map((gate) => ({
    ...gate,
    files: gateFiles(gate, tracked)
  }));
  const findings = findUncovered({ gates, entries });

  if (findings.length === 0) {
    const files = gates.reduce((sum, { files: list }) => sum + list.length, 0);

    console.log(
      `check-lint-staged: OK - ${gates.length} gate runs, ${files} file checks covered by ${entries.length} lint-staged entries.`
    );

    return true;
  }

  for (const { label, tool, missing } of findings) {
    console.error(
      `check-lint-staged: \`${label}\` runs ${tool} on ${missing.length} file(s) that no lint-staged entry passes to ${tool}:`
    );

    for (const file of missing.slice(0, SHOWN_PER_GATE)) {
      console.error(`  - ${file}`);
    }
  }

  console.error(
    'Add or widen an entry in .lintstagedrc.mjs that runs the same tool.'
  );

  return false;
}

async function eslintRulesFor(workspace) {
  const require = createRequire(path.join(ROOT, workspace, 'package.json'));
  const { ESLint } = await import(
    pathToFileURL(require.resolve('eslint')).href
  );
  const engines = new Map();

  return async ({ cwd, config, file }) => {
    const key = `${cwd}|${config}`;

    if (!engines.has(key)) {
      engines.set(
        key,
        new ESLint({ cwd, overrideConfigFile: path.join(ROOT, config) })
      );
    }

    const calculated = await engines
      .get(key)
      .calculateConfigForFile(path.join(ROOT, file));

    return calculated?.rules ?? null;
  };
}

async function checkEslintParity(workspace) {
  const tracked = trackedFiles();
  const entries = await readEntries();
  const rulesFor = await eslintRulesFor(workspace);
  const gates = readGates().filter(
    ({ tool, config }) =>
      tool === 'eslint' && config?.startsWith(`${workspace}/`)
  );
  const drift = [];
  let compared = 0;

  for (const gate of gates) {
    for (const file of gateFiles(gate, tracked)) {
      const entry = entries.find(
        ({ pattern, tools }) =>
          tools.includes('eslint') && entryMatches(pattern, file)
      );

      // A file with no entry is a finding of the default mode.
      if (!entry) continue;

      // The same directory and the same config give the same rules.
      if (gate.cwd === ROOT && entry.eslintConfig === gate.config) continue;

      compared += 1;

      const names = differingRules(
        await rulesFor({ cwd: gate.cwd, config: gate.config, file }),
        await rulesFor({ cwd: ROOT, config: entry.eslintConfig, file })
      );

      if (names.length > 0) drift.push({ file, names, label: gate.label });
    }
  }

  if (drift.length === 0) {
    console.log(
      `check-lint-staged --eslint ${workspace}: OK - ${compared} file(s) get the same rules from the root as from their gate.`
    );

    return true;
  }

  console.error(
    `check-lint-staged --eslint ${workspace}: ${drift.length} file(s) get other ESLint rules in the pre-commit run (from the root) than in their gate:`
  );

  for (const { file, names, label } of drift.slice(0, SHOWN_PER_GATE)) {
    console.error(`  - ${file} (${label}): ${names.join(', ')}`);
  }

  console.error(
    'Give each config block with a relative `files` pattern `basePath: __dirname`.'
  );

  return false;
}

function selfTest() {
  const failures = [];
  const expect = (name, actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(
        `${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
      );
    }
  };
  const entries = [
    { pattern: 'server/src/**/*.ts', tools: ['prettier', 'eslint'] },
    { pattern: 'server/*.ts', tools: ['prettier'] },
    {
      pattern: '{.lintstagedrc.mjs,eslint.base.config.mjs}',
      tools: ['prettier']
    }
  ];

  expect(
    'a file outside every entry',
    findUncovered({
      gates: [
        {
          label: 'server lint',
          tool: 'eslint',
          files: ['server/src/a.ts', 'server/test/b.ts']
        }
      ],
      entries
    }),
    [{ label: 'server lint', tool: 'eslint', missing: ['server/test/b.ts'] }]
  );
  expect(
    'an entry that runs another tool',
    findUncovered({
      gates: [
        {
          label: 'server lint',
          tool: 'eslint',
          files: ['server/jest.config.ts']
        }
      ],
      entries
    }).map(({ missing }) => missing),
    [['server/jest.config.ts']]
  );
  expect(
    'a pattern with no slash matches the base name',
    findUncovered({
      gates: [
        {
          label: 'server format:check',
          tool: 'prettier',
          files: ['.lintstagedrc.mjs', 'server/src/a.ts']
        }
      ],
      entries
    }),
    []
  );
  expect(
    'a command with a config and globs',
    parseCommand('eslint -c server/eslint.config.ts "scripts/*.mjs"', ROOT),
    {
      tool: 'eslint',
      globs: ['scripts/*.mjs'],
      config: 'server/eslint.config.ts'
    }
  );
  expect(
    'a command of another program',
    parseCommand('npm run check:i18n', ROOT),
    null
  );
  expect(
    'a rule that the root run turns on',
    differingRules(
      { 'no-console': [0], eqeqeq: [2] },
      { 'no-console': [2], eqeqeq: [2] }
    ),
    ['no-console']
  );
  expect(
    'a file that one side ignores',
    differingRules({ eqeqeq: [2] }, null),
    ['<ignored>']
  );
  expect('equal rules', differingRules({ eqeqeq: [2] }, { eqeqeq: [2] }), []);

  if (failures.length > 0) {
    for (const failure of failures) console.error(`self-test: ${failure}`);

    return false;
  }

  console.log('check-lint-staged --self-test: OK - 8 cases.');

  return true;
}

const args = process.argv.slice(2);
let passed;

if (args.includes('--self-test')) {
  passed = selfTest();
} else if (args[0] === '--eslint') {
  if (!WORKSPACES.includes(args[1])) {
    console.error(`Usage: --eslint <${WORKSPACES.join('|')}>`);
    process.exit(2);
  }

  passed = await checkEslintParity(args[1]);
} else {
  passed = await checkCoverage();
}

process.exitCode = passed ? 0 : 1;
