/**
 * The boundary between the two TypeORM data sources, for
 * `dependency-graph.mjs`: an entity of the settings data source and an entity
 * of the regional one do not import each other as a value. A relation needs
 * the class of its target as a value (`@ManyToOne(() => Role)`), so this
 * refuses a relation across the two sources, which fails once the sources are
 * two databases. A type-only import stays allowed: it gives the shape of a
 * projection that the code fills from the other source (`User.roles`), and
 * the compiler refuses its use as a value. A crossing key is a plain id
 * column and imports nothing.
 *
 * An entity belongs to the settings source when its `@Entity` names
 * `schema: SETTINGS_SCHEMA`; `server/src/database-roles.spec.ts` checks that
 * the entities with that schema are the `SETTINGS_ENTITIES` of
 * `server/src/data-sources.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENTITY_FILE = /^server\/src\/.*\.entity\.ts$/;
const ENTITY_DECORATOR = /@Entity\(([^)]*)\)/;
const SETTINGS_OPTION = /\bschema:\s*SETTINGS_SCHEMA\b/;

/** The data source of the entity that `text` declares, or `null`. */
export function entitySource(text) {
  const match = ENTITY_DECORATOR.exec(text);

  if (!match) return null;

  return SETTINGS_OPTION.test(match[1]) ? 'settings' : 'regional';
}

/** Maps each entity file of `files` to its data source. */
export function entitySources(root, files) {
  const sources = new Map();

  for (const file of files.filter((name) => ENTITY_FILE.test(name))) {
    const source = entitySource(readFileSync(join(root, file), 'utf8'));

    if (source) sources.set(file, source);
  }

  return sources;
}

/**
 * The value imports between entities of different data sources, as
 * `from -> to` lines. `modules` is the `modules` list of a cruise result.
 */
export function dataSourceBoundaryViolations(modules, sources) {
  const found = new Set(sources.values());
  // A changed declaration form puts every entity on one side, and the check
  // then finds no crossing at all.
  const missing = ['settings', 'regional'].filter((name) => !found.has(name));

  if (missing.length > 0) {
    return missing.map(
      (name) =>
        `no entity of the ${name} data source found: check ENTITY_DECORATOR and SETTINGS_OPTION`
    );
  }

  return modules.flatMap(({ source, dependencies }) => {
    const from = sources.get(source);

    if (!from) return [];

    return dependencies
      .filter(({ resolved, dependencyTypes }) => {
        const to = sources.get(resolved);

        return to && to !== from && !dependencyTypes.includes('type-only');
      })
      .map(({ resolved }) => `${source} (${from}) -> ${resolved}`);
  });
}

export function dataSourceBoundarySelfTest() {
  const failures = [];
  const declarations = [
    ["@Entity({ name: 'roles', schema: SETTINGS_SCHEMA })", 'settings'],
    ["@Entity({\n  name: 'plans',\n  schema: SETTINGS_SCHEMA\n})", 'settings'],
    ["@Entity('users')", 'regional'],
    ["@Entity({ name: 'audit_logs' })", 'regional'],
    ['export class RoleDto {}', null]
  ];

  for (const [text, expected] of declarations) {
    const actual = entitySource(text);

    if (actual !== expected) failures.push({ input: text, expected, actual });
  }

  const sources = new Map([
    ['role.entity.ts', 'settings'],
    ['plan.entity.ts', 'settings'],
    ['user.entity.ts', 'regional'],
    ['invoice.entity.ts', 'regional']
  ]);
  const edge = (resolved, ...types) => ({
    resolved,
    dependencyTypes: ['local', ...types, 'import']
  });
  const modules = [
    { source: 'user.entity.ts', dependencies: [edge('role.entity.ts')] },
    { source: 'plan.entity.ts', dependencies: [edge('invoice.entity.ts')] },
    {
      source: 'invoice.entity.ts',
      dependencies: [edge('role.entity.ts', 'type-only')]
    },
    { source: 'role.entity.ts', dependencies: [edge('plan.entity.ts')] },
    { source: 'user.service.ts', dependencies: [edge('role.entity.ts')] }
  ];
  const expected = [
    'user.entity.ts (regional) -> role.entity.ts',
    'plan.entity.ts (settings) -> invoice.entity.ts'
  ];
  const actual = dataSourceBoundaryViolations(modules, sources);

  if (actual.join('|') !== expected.join('|')) {
    failures.push({ input: 'boundary edges', expected, actual });
  }

  const oneSided = dataSourceBoundaryViolations(
    modules,
    new Map([['user.entity.ts', 'regional']])
  );

  if (!oneSided.some((line) => line.includes('settings data source'))) {
    failures.push({
      input: 'no settings entity',
      expected: 'refused',
      actual: oneSided
    });
  }

  return failures;
}
