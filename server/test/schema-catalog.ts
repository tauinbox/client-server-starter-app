import { createHash } from 'node:crypto';
import type { DataSource } from 'typeorm';

/**
 * The schema of one database as the catalog of Postgres gives it, in a form
 * that two databases can compare: extensions, enums, functions, sequences,
 * tables (columns, constraints, indexes, triggers), the other object kinds,
 * and the rows of each table that holds rows.
 *
 * The migrations tables of TypeORM are left out, because their rows name the
 * migrations that built the schema, not the schema. In a row, a timestamp
 * value becomes `set` (it holds the time of the run) and so does each column
 * of `VOLATILE_COLUMNS` (a random value of each database).
 */
export interface SchemaCatalog {
  extensions: string[];
  enums: Record<string, string[]>;
  functions: string[];
  sequences: string[];
  tables: Record<string, TableCatalog>;
  otherObjects: string[];
  rows: Record<string, string[]>;
}

export interface TableCatalog {
  options: string;
  columns: string[];
  constraints: string[];
  indexes: string[];
  triggers: string[];
}

const MIGRATION_TABLES = ['migrations', 'settings_migrations'];

const VOLATILE_COLUMNS: Record<string, string[]> = {
  settings_change_epoch: ['epoch']
};

type Row = Record<string, unknown>;

async function rows<T extends Row>(
  source: DataSource,
  sql: string,
  parameters: unknown[]
): Promise<T[]> {
  return source.query<T[]>(sql, parameters);
}

export async function describeSchema(
  source: DataSource
): Promise<SchemaCatalog> {
  const [{ schema }] = await rows<{ schema: string }>(
    source,
    'SELECT current_schema() AS "schema"',
    []
  );
  const p = [schema];

  const extensions = await rows<{ name: string }>(
    source,
    `SELECT extname AS "name" FROM pg_extension
      WHERE extname <> 'plpgsql' ORDER BY 1`,
    []
  );
  const enums = await rows<{ name: string; labels: string[] }>(
    source,
    `SELECT t.typname AS "name",
            array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS "labels"
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1
      GROUP BY t.typname ORDER BY 1`,
    p
  );
  const functions = await rows<{ def: string }>(
    source,
    `SELECT pg_get_functiondef(f.oid) AS "def"
       FROM pg_proc f
       JOIN pg_namespace n ON n.oid = f.pronamespace
      WHERE n.nspname = $1
        AND NOT EXISTS (SELECT 1 FROM pg_depend d
                         WHERE d.objid = f.oid AND d.deptype = 'e')
      ORDER BY 1`,
    p
  );
  const sequences = await rows<{ def: string }>(
    source,
    `SELECT concat_ws(' ', sequencename, data_type, start_value, increment_by,
                      min_value, max_value, cache_size, cycle) AS "def"
       FROM pg_sequences
      WHERE schemaname = $1
        AND sequencename <> ALL($2)
      ORDER BY 1`,
    [schema, MIGRATION_TABLES.map((table) => `${table}_id_seq`)]
  );
  const otherObjects = await rows<{ def: string }>(
    source,
    `SELECT 'relation ' || c.relname || ' ' || c.relkind::text AS "def"
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind NOT IN ('r', 'p', 'i', 'S')
     UNION ALL
     SELECT 'type ' || t.typname || ' ' || t.typtype::text
       FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1 AND t.typtype IN ('d', 'r', 'm')
     UNION ALL
     SELECT 'policy ' || pol.polname FROM pg_policy pol
       JOIN pg_class c ON c.oid = pol.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1
     UNION ALL
     SELECT 'rule ' || rulename FROM pg_rules WHERE schemaname = $1
     UNION ALL
     SELECT 'publication ' || pubname FROM pg_publication
     UNION ALL
     SELECT 'event trigger ' || evtname FROM pg_event_trigger
     UNION ALL
     SELECT 'comment ' || c.relname || '.' || coalesce(a.attname, '')
       FROM pg_description d
       JOIN pg_class c ON c.oid = d.objoid AND d.classoid = 'pg_class'::regclass
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid
      WHERE n.nspname = $1
      ORDER BY 1`,
    p
  );
  const tableRows = await rows<{
    oid: number;
    name: string;
    options: string;
  }>(
    source,
    `SELECT c.oid::int AS "oid", c.relname AS "name",
            concat_ws(' ', c.relkind, c.relpersistence, c.relreplident,
                      c.reloptions::text) AS "options"
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
        AND c.relname <> ALL($2)
      ORDER BY 2`,
    [schema, MIGRATION_TABLES]
  );

  const tables: Record<string, TableCatalog> = {};
  const data: Record<string, string[]> = {};

  for (const { oid, name, options } of tableRows) {
    const table = await describeTable(source, oid);
    const values = await tableData(source, {
      table: name,
      timestamps: table.timestampColumns
    });

    tables[name] = { options, ...table.catalog };

    if (values.length > 0) data[name] = values;
  }

  return {
    extensions: extensions.map(({ name }) => name),
    enums: Object.fromEntries(enums.map(({ name, labels }) => [name, labels])),
    functions: functions.map(({ def }) => def),
    sequences: sequences.map(({ def }) => def),
    tables,
    otherObjects: otherObjects.map(({ def }) => def),
    rows: data
  };
}

/**
 * A SHA-256 of each part of the catalog: each table, the rows of each table,
 * and each other section. A difference names the part that changed.
 */
export function catalogDigest(catalog: SchemaCatalog): Record<string, string> {
  const { tables, rows: data, ...sections } = catalog;
  const parts: Array<[string, unknown]> = [
    ...Object.entries(sections),
    ['table names', Object.keys(tables)],
    ['tables with rows', Object.keys(data)],
    ...Object.entries(tables).map(([name, table]): [string, unknown] => [
      `table ${name}`,
      table
    ]),
    ...Object.entries(data).map(([name, values]): [string, unknown] => [
      `rows ${name}`,
      values
    ])
  ];

  return Object.fromEntries(
    parts.map(([key, value]) => [
      key,
      createHash('sha256').update(JSON.stringify(value)).digest('hex')
    ])
  );
}

async function describeTable(
  source: DataSource,
  oid: number
): Promise<{
  catalog: Omit<TableCatalog, 'options'>;
  timestampColumns: string[];
}> {
  const columns = await rows<{ name: string; type: string; def: string }>(
    source,
    `SELECT a.attname AS "name",
            format_type(a.atttypid, a.atttypmod) AS "type",
            concat_ws(' ', a.attname, format_type(a.atttypid, a.atttypmod),
                      CASE WHEN a.attnotnull THEN 'NOT NULL' END,
                      'DEFAULT ' || pg_get_expr(d.adbin, d.adrelid),
                      NULLIF(a.attidentity, ''), NULLIF(a.attgenerated, ''),
                      'COLLATE ' || co.collname) AS "def"
       FROM pg_attribute a
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       LEFT JOIN pg_collation co ON co.oid = a.attcollation
                                AND co.collname <> 'default'
      WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [oid]
  );
  const constraints = await rows<{ def: string }>(
    source,
    `SELECT conname || ' ' || pg_get_constraintdef(oid) AS "def"
       FROM pg_constraint WHERE conrelid = $1 ORDER BY 1`,
    [oid]
  );
  const indexes = await rows<{ def: string }>(
    source,
    `SELECT pg_get_indexdef(indexrelid) AS "def"
       FROM pg_index WHERE indrelid = $1 ORDER BY 1`,
    [oid]
  );
  const triggers = await rows<{ def: string }>(
    source,
    `SELECT pg_get_triggerdef(oid) AS "def"
       FROM pg_trigger WHERE tgrelid = $1 AND NOT tgisinternal ORDER BY 1`,
    [oid]
  );

  return {
    catalog: {
      columns: columns.map(({ def }) => def),
      constraints: constraints.map(({ def }) => def),
      indexes: indexes.map(({ def }) => def),
      triggers: triggers.map(({ def }) => def)
    },
    timestampColumns: columns
      .filter(({ type }) => type.startsWith('timestamp'))
      .map(({ name }) => name)
  };
}

async function tableData(
  source: DataSource,
  { table, timestamps }: { table: string; timestamps: string[] }
): Promise<string[]> {
  const masked = new Set([...timestamps, ...(VOLATILE_COLUMNS[table] ?? [])]);
  const found = await rows<{ row: Row }>(
    source,
    `SELECT to_jsonb(t) AS "row" FROM "${table}" t`,
    []
  );

  return found
    .map(({ row }) =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(row)
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(([column, value]) => [
              column,
              masked.has(column) && value !== null ? 'set' : value
            ])
        )
      )
    )
    .toSorted();
}
