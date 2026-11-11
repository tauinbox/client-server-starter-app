/**
 * Finds two read-then-write races in the methods of the services and the
 * listeners under src/modules. A read is a `findOne*` or `exists*` call, or a
 * call of a method of the same file that makes one (a `loadRole(id)` helper).
 *
 * 1. A read, then a `delete`, `remove`, `softDelete` or `softRemove` that
 *    does not decide from its own result: the method reads no `affected`,
 *    neither it nor a method of the same file that it calls takes a
 *    pessimistic lock, and the delete has no `where`. Of two concurrent
 *    requests, both pass the read, and both then act as if they removed the
 *    row.
 * 2. A read, then a throw of a key that refuses a duplicate (`*_EXISTS`,
 *    `ALREADY_*`), then a `save` or an `insert`, and no unique violation is
 *    caught (`isUniqueViolation`, `orIgnore`, `onConflict`) in the method or in
 *    a method of the same file that it calls. The unique index then refuses
 *    the loser of a race with another answer than the read check gives.
 * 3. An entity loaded by `find*` with no pessimistic lock, then given to
 *    `save`, in the method or through a parameter of a method of the same
 *    file. `save` writes every column of the loaded copy, so it undoes a
 *    concurrent write that landed after the read.
 * 4. An instance check (`assertCan`, `assertCanWrite`, ...) that runs before
 *    the transaction of the write and not again inside it. The check then
 *    judges a row that a concurrent change can move out of the rights of the
 *    caller before the write. Inside means in a callback of `transaction` or
 *    `withTransaction`, or of a method of the same file that runs one, or in
 *    a function that such a callback calls or receives.
 * 5. An entity loaded by `find*` with no pessimistic lock, a read of one of its
 *    columns, then an `update` keyed only on the id that writes that column,
 *    in the method or through a parameter of a method of the same file. The
 *    read decided the write, and a concurrent write that landed after the read
 *    is overwritten. Put the read value in the where of the update.
 *
 * A method with `// race-checked: <reason>` on the line above it is skipped.
 *
 * Usage (from server/): npm run check:race
 *        npm run check:race -- --self-test
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const SRC_DIR = path.resolve(__dirname, '../src');
const MODULES_DIR = path.join(SRC_DIR, 'modules');
const SCANNED_SUFFIXES = ['.service.ts', '.listener.ts'];

const READ = /^(findOne|exists)/;
const ENTITY_READ = /^find(By|One(By|OrFail)?)?$/;
const DELETES = new Set(['delete', 'remove', 'softDelete', 'softRemove']);
const WRITES = new Set(['save', 'insert']);
const UNIQUE_HANDLING = new Set([
  'isUniqueViolation',
  'orIgnore',
  'onConflict'
]);
const LOCKS = new Set(['lock', 'setLock']);
const DUPLICATE_KEY = /_EXISTS$|(^|_)ALREADY_/;
const INSTANCE_CHECKS = new Set([
  'assertCan',
  'assertCanWrite',
  'assertCanRole',
  'assertCanUpdate',
  'assertCanWiden',
  'assertNotSuperTarget'
]);
const TRANSACTIONS = new Set(['transaction', 'withTransaction']);
const MARKER = /\/\/\s*race-checked:\s*\S/;

type Body = ts.FunctionLikeDeclaration;

/** Whether a method of the same file returns an entity read with no lock. */
type ReadMemo = Map<Body, boolean>;

/** Function name to the `GROUP.NAME` error keys that its body names. */
type KeyIndex = Map<string, Set<string>>;

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);

    if (e.isDirectory()) return listFiles(full);

    return e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [full] : [];
  });
}

function parse(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/** The name of the called method or function: `a.b.name(` and `name(`. */
function calleeName(call: ts.CallExpression): string {
  const callee = call.expression;

  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;

  if (ts.isIdentifier(callee)) return callee.text;

  return '';
}

function calls(node: ts.Node): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];

  walk(node, (n) => {
    if (ts.isCallExpression(n)) found.push(n);
  });

  return found;
}

function hasIdentifier(node: ts.Node, names: Set<string>): boolean {
  let found = false;

  walk(node, (n) => {
    if (
      (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) &&
      names.has(n.text)
    ) {
      found = true;
    }
  });

  return found;
}

/** Every `ErrorKeys.GROUP.NAME` in the node, as `GROUP.NAME`. */
function keysIn(node: ts.Node): Set<string> {
  const keys = new Set<string>();

  walk(node, (n) => {
    if (
      ts.isPropertyAccessExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'ErrorKeys'
    ) {
      keys.add(`${n.expression.name.text}.${n.name.text}`);
    }
  });

  return keys;
}

/** The functions and methods of a file, by name. */
function bodiesOf(sf: ts.SourceFile): Map<string, Body> {
  const bodies = new Map<string, Body>();

  walk(sf, (n) => {
    if (
      (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) &&
      n.name &&
      (ts.isIdentifier(n.name) || ts.isPrivateIdentifier(n.name))
    ) {
      bodies.set(n.name.text, n);
    }
  });

  return bodies;
}

/** The exported functions of every file under src, with their error keys. */
function exportedKeyIndex(): KeyIndex {
  const index: KeyIndex = new Map();

  for (const file of listFiles(SRC_DIR)) {
    const sf = parse(file, fs.readFileSync(file, 'utf-8'));

    for (const statement of sf.statements) {
      if (
        ts.isFunctionDeclaration(statement) &&
        statement.name &&
        statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        index.set(statement.name.text, keysIn(statement));
      }
    }
  }

  return index;
}

/** The method and every method or function of the same file that it calls. */
function reachable(method: Body, local: Map<string, Body>): Body[] {
  const seen = new Set<Body>([method]);
  const queue = [method];

  while (queue.length > 0) {
    const current = queue.pop()!;

    for (const call of calls(current)) {
      const callee = local.get(calleeName(call));

      if (callee && !seen.has(callee)) {
        seen.add(callee);
        queue.push(callee);
      }
    }
  }

  return [...seen];
}

class MethodScan {
  constructor(
    private readonly method: Body,
    private readonly sf: ts.SourceFile,
    private readonly local: Map<string, Body>,
    private readonly exported: KeyIndex
  ) {}

  problems(): string[] {
    const found = [
      this.staleSave(),
      this.staleKeyedUpdate(),
      checkOutsideTransaction(this.method, this.local, this.label())
    ];
    const read = this.firstRead();

    if (read !== undefined) {
      found.push(this.unguardedDelete(read), this.duplicateRead(read));
    }

    return found.filter((p): p is string => p !== undefined);
  }

  private staleSave(): string | undefined {
    const stale = [...loadedEntities(this.method, this.local)].some((decl) =>
      reachesSave(scopeOf(decl), {
        name: decl.name.getText(this.sf),
        after: decl.getStart(),
        local: this.local,
        seen: new Set()
      })
    );

    if (!stale) return undefined;

    return `${this.label()}: a loaded entity is written back with save; write only the changed columns with a keyed update`;
  }

  private staleKeyedUpdate(): string | undefined {
    const sites = new Set<string>();

    for (const decl of loadedEntities(this.method, this.local)) {
      updatesFromRead(scopeOf(decl), {
        name: decl.name.getText(this.sf),
        after: decl.getStart(),
        local: this.local,
        seen: new Set(),
        sites
      });
    }

    if (sites.size === 0) return undefined;

    return `${this.label()}: a column of a loaded entity decides an update keyed only on the id (${[...sites].join(', ')}); put the read value in the where of the update`;
  }

  private label(): string {
    const name = this.method.name?.getText(this.sf) ?? '<anonymous>';
    const start = this.method.getStart(this.sf);
    const line = this.sf.getLineAndCharacterOfPosition(start).line + 1;

    return `${this.sf.fileName}:${line} ${name}`;
  }

  private firstRead(): number | undefined {
    const readsDirectly = (body: Body) =>
      calls(body).some((c) => READ.test(calleeName(c)));

    return calls(this.method)
      .filter((c) => {
        const name = calleeName(c);

        if (READ.test(name)) return true;

        const callee = this.local.get(name);

        return (
          callee !== undefined &&
          callee !== this.method &&
          reachable(callee, this.local).some(readsDirectly)
        );
      })
      .map((c) => c.getStart())
      .toSorted((a, b) => a - b)[0];
  }

  private unguardedDelete(read: number): string | undefined {
    const unguarded = calls(this.method).some(
      (c) =>
        c.getStart() > read &&
        DELETES.has(calleeName(c)) &&
        ts.isPropertyAccessExpression(c.expression) &&
        !deleteHasWhere(c)
    );

    if (
      !unguarded ||
      hasIdentifier(this.method, new Set(['affected'])) ||
      reachable(this.method, this.local).some((body) =>
        hasIdentifier(body, LOCKS)
      )
    ) {
      return undefined;
    }

    return `${this.label()}: a read, then a delete that reads no "affected" and takes no lock`;
  }

  private duplicateRead(read: number): string | undefined {
    const refusals: { pos: number; keys: string[] }[] = [];

    walk(this.method, (n) => {
      if (!ts.isThrowStatement(n) || n.getStart() < read) return;

      const keys = [...this.thrownKeys(n.expression)].filter((k) =>
        DUPLICATE_KEY.test(k.split('.')[1])
      );

      if (keys.length > 0) refusals.push({ pos: n.getStart(), keys });
    });

    if (refusals.length === 0) return undefined;

    const first = Math.min(...refusals.map((r) => r.pos));
    const writes = calls(this.method).some(
      (c) => c.getStart() > first && WRITES.has(calleeName(c))
    );
    const handled = reachable(this.method, this.local).some((body) =>
      hasIdentifier(body, UNIQUE_HANDLING)
    );

    if (!writes || handled) return undefined;

    const keys = [...new Set(refusals.flatMap((r) => r.keys))].join(', ');

    return `${this.label()}: a read refuses with ${keys}, then a write; map the unique violation to the same key`;
  }

  /** The keys that a throw raises: its own, or those of the helper it calls. */
  private thrownKeys(thrown: ts.Expression): Set<string> {
    const keys = keysIn(thrown);

    if (ts.isCallExpression(thrown)) {
      const name = calleeName(thrown);
      const helper = this.local.get(name);
      const helperKeys = helper ? keysIn(helper) : this.exported.get(name);

      helperKeys?.forEach((k) => keys.add(k));
    }

    return keys;
  }
}

/** A query builder delete, `.delete().from(X).where(...)`, with a condition. */
function deleteHasWhere(call: ts.CallExpression): boolean {
  let node: ts.Node = call;

  while (
    ts.isPropertyAccessExpression(node.parent) ||
    ts.isCallExpression(node.parent)
  ) {
    node = node.parent;

    if (
      ts.isCallExpression(node) &&
      ['where', 'andWhere'].includes(calleeName(node))
    ) {
      return true;
    }
  }

  return false;
}

/** The method of the same file that `this.name(` or `name(` calls. */
function localCallee(
  call: ts.CallExpression,
  local: Map<string, Body>
): Body | undefined {
  const callee = call.expression;
  const own =
    ts.isIdentifier(callee) ||
    (ts.isPropertyAccessExpression(callee) &&
      callee.expression.kind === ts.SyntaxKind.ThisKeyword);

  return own ? local.get(calleeName(call)) : undefined;
}

function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;

  while (
    ts.isAwaitExpression(e) ||
    ts.isParenthesizedExpression(e) ||
    ts.isNonNullExpression(e)
  ) {
    e = e.expression;
  }

  return e;
}

/**
 * An expression that gives an entity read with no lock: a `find*` call, a
 * name bound to one, or a call of a method of the same file that returns one.
 */
function isUnlockedRead(
  expr: ts.Expression,
  {
    loaded,
    local,
    memo
  }: { loaded: Set<string>; local: Map<string, Body>; memo: ReadMemo }
): boolean {
  const e = unwrap(expr);

  if (ts.isIdentifier(e)) return loaded.has(e.text);

  if (!ts.isCallExpression(e)) return false;

  const helper = localCallee(e, local);

  if (helper) {
    const known = memo.get(helper);

    if (known !== undefined) return known;

    // A recursive call reads as no read until the helper is resolved.
    memo.set(helper, false);
    const result = returnsUnlockedRead(helper, local, memo);

    memo.set(helper, result);

    return result;
  }

  return ENTITY_READ.test(calleeName(e)) && !hasIdentifier(e, LOCKS);
}

function returnsUnlockedRead(
  body: Body,
  local: Map<string, Body>,
  memo: ReadMemo
): boolean {
  const loaded = new Set(
    [...loadedEntities(body, local, memo)].map((d) => d.name.getText())
  );
  let found = false;

  walk(body, (n) => {
    if (
      ts.isReturnStatement(n) &&
      n.expression &&
      isUnlockedRead(n.expression, { loaded, local, memo })
    ) {
      found = true;
    }
  });

  return found;
}

/** The variables of a body that hold an entity read with no lock. */
function loadedEntities(
  body: Body,
  local: Map<string, Body>,
  memo: ReadMemo = new Map()
): Set<ts.VariableDeclaration> {
  const loaded = new Set<ts.VariableDeclaration>();
  const names = new Set<string>();

  walk(body, (n) => {
    if (!ts.isVariableDeclaration(n) || !ts.isIdentifier(n.name)) return;

    const loop = n.parent.parent;
    const source = ts.isForOfStatement(loop) ? loop.expression : n.initializer;

    if (source && isUnlockedRead(source, { loaded: names, local, memo })) {
      loaded.add(n);
      names.add(n.name.text);
    }
  });

  return loaded;
}

/** The block of a `const`, or the loop of a `for...of` variable. */
function scopeOf(decl: ts.VariableDeclaration): ts.Node {
  const holder = decl.parent.parent;

  return ts.isVariableStatement(holder) ? holder.parent : holder;
}

/**
 * True if `name` is given to `save` after `after`, in the scope or through a
 * parameter of a method of the same file.
 */
function reachesSave(
  scope: ts.Node,
  {
    name,
    after,
    local,
    seen
  }: {
    name: string;
    after: number;
    local: Map<string, Body>;
    seen: Set<string>;
  }
): boolean {
  return calls(scope).some((c) => {
    if (c.getStart() <= after) return false;

    const indexes = c.arguments
      .map((a, i) => (ts.isIdentifier(a) && a.text === name ? i : -1))
      .filter((i) => i >= 0);

    if (indexes.length === 0) return false;

    if (calleeName(c) === 'save') return true;

    const helper = localCallee(c, local);
    const body = helper?.body;

    if (!helper || !body) return false;

    return indexes.some((i) => {
      const param = helper.parameters[i]?.name;
      const key = `${calleeName(c)}#${i}`;

      if (!param || !ts.isIdentifier(param) || seen.has(key)) return false;

      seen.add(key);

      return reachesSave(body, { name: param.text, after: -1, local, seen });
    });
  });
}

/** The criteria and the values of `repo.update(c, v)` or `em.update(E, c, v)`. */
function updateArguments(
  call: ts.CallExpression
): { criteria: ts.Expression; values: ts.Expression } | undefined {
  if (
    calleeName(call) !== 'update' ||
    !ts.isPropertyAccessExpression(call.expression)
  ) {
    return undefined;
  }

  const [first] = call.arguments;
  const entityFirst =
    first !== undefined && ts.isIdentifier(first) && /^[A-Z]/.test(first.text);
  const [criteria, values] = call.arguments.slice(entityFirst ? 1 : 0);

  return criteria && values ? { criteria, values } : undefined;
}

/** A criteria that names the primary key and nothing else. */
function keyedOnIdOnly(criteria: ts.Expression): boolean {
  if (ts.isIdentifier(criteria)) return criteria.text === 'id';

  if (ts.isPropertyAccessExpression(criteria)) {
    return criteria.name.text === 'id';
  }

  if (!ts.isObjectLiteralExpression(criteria)) return false;

  const { properties } = criteria;

  return (
    properties.length === 1 &&
    (ts.isPropertyAssignment(properties[0]) ||
      ts.isShorthandPropertyAssignment(properties[0])) &&
    properties[0].name.getText() === 'id'
  );
}

/** The column names that the values of an update write. */
function writtenColumns(values: ts.Expression): Set<string> {
  const columns = new Set<string>();

  walk(values, (n) => {
    if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) {
      columns.add(n.name.getText());
    }
  });

  return columns;
}

/**
 * Collects into `sites` each update keyed only on the id that writes a column
 * of `name` read before it, in the scope or through a parameter of a method of
 * the same file.
 */
function updatesFromRead(
  scope: ts.Node,
  {
    name,
    after,
    local,
    seen,
    sites
  }: {
    name: string;
    after: number;
    local: Map<string, Body>;
    seen: Set<string>;
    sites: Set<string>;
  }
): void {
  const reads: { column: string; pos: number }[] = [];

  walk(scope, (n) => {
    if (
      ts.isPropertyAccessExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === name &&
      n.getStart() > after
    ) {
      reads.push({ column: n.name.text, pos: n.getStart() });
    }
  });

  for (const c of calls(scope)) {
    if (c.getStart() <= after) continue;

    const update = updateArguments(c);

    if (update && keyedOnIdOnly(update.criteria)) {
      const written = writtenColumns(update.values);
      const decides = reads.some(
        (r) => r.pos < c.getStart() && written.has(r.column)
      );

      if (decides) {
        const sf = c.getSourceFile();
        const holder = local
          .values()
          .find(
            (b) => b.getStart() <= c.getStart() && c.getEnd() <= b.getEnd()
          );

        sites.add(holder?.name?.getText(sf) ?? '<anonymous>');
      }
    }

    const helper = localCallee(c, local);
    const body = helper?.body;

    if (!helper || !body) continue;

    c.arguments.forEach((a, i) => {
      const param = helper.parameters[i]?.name;
      const key = `${calleeName(c)}#${i}`;

      if (
        !ts.isIdentifier(a) ||
        a.text !== name ||
        !param ||
        !ts.isIdentifier(param) ||
        seen.has(key)
      ) {
        return;
      }

      seen.add(key);
      updatesFromRead(body, {
        name: param.text,
        after: -1,
        local,
        seen,
        sites
      });
    });
  }
}

type FunctionNode = ts.ArrowFunction | ts.FunctionExpression;

/** The `const name = () => ...` functions declared in a method, by name. */
function closuresOf(method: Body): Map<string, FunctionNode> {
  const closures = new Map<string, FunctionNode>();

  walk(method, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) ||
        ts.isFunctionExpression(n.initializer))
    ) {
      closures.set(n.name.text, n.initializer);
    }
  });

  return closures;
}

/** Whether the method or a method of the same file that it calls runs one. */
function runsTransaction(body: Body, local: Map<string, Body>): boolean {
  return reachable(body, local).some((b) =>
    calls(b).some((c) => TRANSACTIONS.has(calleeName(c)))
  );
}

/** A call whose function arguments run inside a transaction. */
function isTransactionRunner(
  call: ts.CallExpression,
  local: Map<string, Body>
): boolean {
  if (TRANSACTIONS.has(calleeName(call))) return true;

  const helper = localCallee(call, local);

  return helper !== undefined && runsTransaction(helper, local);
}

/**
 * The closure that a use of `id` names: a call, an argument or a shorthand
 * property. Not the name of its own declaration, and not a member name.
 */
function closureRef(
  id: ts.Identifier,
  closures: Map<string, FunctionNode>
): FunctionNode | undefined {
  const { parent } = id;

  if (
    (ts.isVariableDeclaration(parent) && parent.name === id) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === id) ||
    (ts.isPropertyAssignment(parent) && parent.name === id)
  ) {
    return undefined;
  }

  return closures.get(id.text);
}

/** Walks the node, but not into the subtrees that `skip` selects. */
function walkUnless(
  node: ts.Node,
  skip: (n: ts.Node) => boolean,
  visit: (n: ts.Node) => void
): void {
  if (skip(node)) return;

  visit(node);
  ts.forEachChild(node, (child) => walkUnless(child, skip, visit));
}

/**
 * The instance checks that run from `nodes`: a direct call, a call of a
 * method of the same file, and a closure of the method that is called or
 * passed on.
 */
function checksFrom(
  nodes: ts.Node[],
  {
    local,
    closures,
    skip = () => false
  }: {
    local: Map<string, Body>;
    closures: Map<string, FunctionNode>;
    skip?: (n: ts.Node) => boolean;
  }
): Set<string> {
  const found = new Set<string>();
  const seen = new Set<ts.Node>();
  const queue: { node: ts.Node; skip: (n: ts.Node) => boolean }[] = nodes.map(
    (node) => ({ node, skip })
  );

  while (queue.length > 0) {
    const current = queue.pop()!;

    walkUnless(current.node, current.skip, (n) => {
      if (ts.isCallExpression(n)) {
        if (INSTANCE_CHECKS.has(calleeName(n))) found.add(calleeName(n));

        const helper = localCallee(n, local);

        if (helper && !seen.has(helper)) {
          seen.add(helper);
          queue.push({ node: helper, skip: () => false });
        }
      }

      const closure = ts.isIdentifier(n) && closureRef(n, closures);

      if (closure && !seen.has(closure)) {
        seen.add(closure);
        queue.push({ node: closure, skip: () => false });
      }
    });
  }

  return found;
}

function checkOutsideTransaction(
  method: Body,
  local: Map<string, Body>,
  label: string
): string | undefined {
  const runners = calls(method).filter((c) => isTransactionRunner(c, local));

  if (runners.length === 0) return undefined;

  const closures = closuresOf(method);
  const runnerArgs = new Set<ts.Node>(runners.flatMap((r) => [...r.arguments]));
  const closureBodies = new Set<ts.Node>(closures.values());
  const outside = checksFrom([method], {
    local,
    closures,
    skip: (n) => runnerArgs.has(n) || closureBodies.has(n)
  });
  const inside = checksFrom([...runnerArgs], { local, closures });
  const missing = [...outside].filter((name) => !inside.has(name));

  if (missing.length === 0) return undefined;

  return `${label}: ${missing.join(', ')} runs before the transaction of the write and not inside it; run it again on the row locked in the transaction`;
}

function isMarked(method: Body, sf: ts.SourceFile): boolean {
  const ranges = ts.getLeadingCommentRanges(sf.text, method.getFullStart());

  return (ranges ?? []).some((r) => MARKER.test(sf.text.slice(r.pos, r.end)));
}

export function scanSource(
  fileName: string,
  source: string,
  exported: KeyIndex
): string[] {
  const sf = parse(fileName, source);
  const local = bodiesOf(sf);
  const problems: string[] = [];

  walk(sf, (n) => {
    if (!ts.isMethodDeclaration(n) || !n.body || isMarked(n, sf)) return;

    problems.push(...new MethodScan(n, sf, local, exported).problems());
  });

  return problems;
}

const SELF_TEST_CASES: { label: string; source: string; fails: boolean }[] = [
  {
    label: 'exists, then a delete with no "affected" read',
    source: `class S {
      async deleteUserSession(userId: string, sessionId: string) {
        const live = await this.repository.exists({ where: { userId, sessionId } });
        if (!live) return false;
        await this.repository.delete({ userId, sessionId });
        return true;
      }
    }`,
    fails: true
  },
  {
    label: 'a read in a helper of the same file, then a remove',
    source: `class S {
      async delete(id: string) {
        const role = await this.loadRole(id);
        await this.manager.transaction((em) => em.remove(Role, role));
      }
      private async loadRole(id: string) {
        return this.repository.findOneOrFail({ where: { id } });
      }
    }`,
    fails: true
  },
  {
    label: 'a delete that decides from "affected"',
    source: `class S {
      async delete(id: string) {
        const role = await this.loadRole(id);
        const { affected } = await this.repository.delete({ id });
        if (!affected) throw notFound();
      }
      private async loadRole(id: string) {
        return this.repository.findOneOrFail({ where: { id } });
      }
    }`,
    fails: false
  },
  {
    label: 'a delete after a pessimistic lock',
    source: `class S {
      async replace(roleId: string) {
        await this.repository.findOne({ where: { id: roleId }, lock: { mode: 'pessimistic_write' } });
        await this.repository.delete({ roleId });
      }
    }`,
    fails: false
  },
  {
    label: 'a delete after a lock that a helper of the same file takes',
    source: `class S {
      async delete(id: string) {
        const role = await this.loadRole(id);
        await this.manager.transaction(async (em) => {
          await this.lockRole(em, id);
          await em.delete(Role, { id });
        });
      }
      private async loadRole(id: string) {
        return this.repository.findOneOrFail({ where: { id } });
      }
      private async lockRole(em: EntityManager, id: string) {
        await em.findOne(Role, { where: { id }, lock: { mode: 'pessimistic_write' } });
      }
    }`,
    fails: false
  },
  {
    label:
      'a read check with a duplicate key, then a save, no violation caught',
    source: `class S {
      async create(email: string) {
        if (await this.repository.findOneBy({ email })) {
          throw new ApiError(ErrorKeys.USERS.EMAIL_EXISTS, 'taken');
        }
        return this.repository.save({ email });
      }
    }`,
    fails: true
  },
  {
    label:
      'a read check with a duplicate key; a called method maps the violation',
    source: `class S {
      async create(email: string) {
        if (await this.repository.findOneBy({ email })) throw taken();
        try {
          return await this.repository.save({ email });
        } catch (error) {
          throw this.mapUnique(error);
        }
      }
      private mapUnique(error: unknown) {
        return isUniqueViolation(error) ? taken() : error;
      }
    }
    function taken() {
      return new ApiError(ErrorKeys.USERS.EMAIL_EXISTS, 'taken');
    }`,
    fails: false
  },
  {
    label: 'a read check with a state key, then a save',
    source: `class S {
      async record(id: string) {
        if (!(await this.repository.findOneBy({ id }))) {
          throw new ApiError(ErrorKeys.BILLING.SUBSCRIPTION_BUSY, 'busy');
        }
        return this.repository.save({ id });
      }
    }`,
    fails: false
  },
  {
    label: 'a loaded entity written back with save',
    source: `class S {
      async rename(id: string, name: string) {
        const role = await this.repository.findOneBy({ id });
        role.name = name;
        return this.repository.save(role);
      }
    }`,
    fails: true
  },
  {
    label: 'a loaded entity saved through a helper of the same file',
    source: `class S {
      async update(id: string, data: Partial<Role>) {
        const role = await this.loadRole(id);
        Object.assign(role, data);
        return this.manager.transaction((em) => this.saveRole(em, role));
      }
      private async loadRole(id: string) {
        const role = await this.repository.findOne({ where: { id } });
        if (!role) throw notFound();
        return role;
      }
      private saveRole(em: EntityManager, role: Role) {
        return em.save(Role, role);
      }
    }`,
    fails: true
  },
  {
    label: 'each item of a loaded list written back with save',
    source: `class S {
      async orphan() {
        const all = await this.repository.find();
        for (const resource of all) {
          resource.isOrphaned = true;
          await this.repository.save(resource);
        }
      }
    }`,
    fails: true
  },
  {
    label: 'a save of a row read under a pessimistic lock',
    source: `class S {
      async pay(em: EntityManager, id: string) {
        const invoice = await this.lockInvoice(em, id);
        invoice.status = 'paid';
        return em.save(invoice);
      }
      private lockInvoice(em: EntityManager, id: string) {
        return em.findOne(Invoice, { where: { id }, lock: { mode: 'pessimistic_write' } });
      }
    }`,
    fails: false
  },
  {
    label: 'a save of a new entity',
    source: `class S {
      async create(name: string) {
        const existing = await this.repository.findOneBy({ name });
        if (existing) return existing;
        return this.repository.save(this.repository.create({ name }));
      }
    }`,
    fails: false
  },
  {
    label: 'a read, then a softRemove with no "affected" read',
    source: `class S {
      async remove(id: string) {
        const user = await this.repository.findOne({ where: { id } });
        await this.manager.transaction((em) => em.softRemove(user));
      }
    }`,
    fails: true
  },
  {
    label: 'an instance check only before the transaction of the write',
    source: `class S {
      async update(id: string, ability: AppAbility) {
        const user = await this.loadUser(id);
        this.assertCanWrite(ability, { target: user });
        await this.dataSource.transaction(async (em) => {
          await em.update(User, { id }, { name: 'x' });
        });
      }
    }`,
    fails: true
  },
  {
    label: 'an instance check repeated on the locked row in the transaction',
    source: `class S {
      async update(id: string, ability: AppAbility) {
        const user = await this.loadUser(id);
        this.assertCanWrite(ability, { target: user });
        await withTransaction(this.dataSource, async (em) => {
          const locked = await em.findOne(User, { where: { id }, lock: { mode: 'pessimistic_write' } });
          this.assertCanWrite(ability, { target: locked });
          await em.update(User, { id }, { name: 'x' });
        });
      }
    }`,
    fails: false
  },
  {
    label:
      'a check closure called early and passed to a method that runs the transaction',
    source: `class S {
      async update(id: string, ability: AppAbility) {
        const check = (row: Role) => this.assertCanRole(ability, { record: row });
        check(await this.loadRole(id));
        await this.writeLocked(id, { check });
      }
      private writeLocked(id: string, { check }: { check: (row: Role) => void }) {
        return this.manager.transaction(async (em) => {
          check(await em.findOne(Role, { where: { id }, lock: { mode: 'pessimistic_write' } }));
          await em.update(Role, { id }, { name: 'x' });
        });
      }
    }`,
    fails: false
  },
  {
    label:
      'a check in a helper before a method that runs the transaction without it',
    source: `class S {
      async update(id: string, ability: AppAbility) {
        this.assertCanEdit(ability, await this.loadRole(id));
        await this.writeLocked(id);
      }
      private assertCanEdit(ability: AppAbility, role: Role) {
        this.accessRefusals.assertCan(ability, { subject: role });
      }
      private writeLocked(id: string) {
        return this.manager.transaction((em) => em.update(Role, { id }, { name: 'x' }));
      }
    }`,
    fails: true
  },
  {
    label: 'a status read, then an update keyed only on the id writes it',
    source: `class S {
      async replay(id: string) {
        const event = await this.repository.findOne({ where: { id } });
        if (event.status !== 'dead_letter') throw notReplayable();
        await this.repository.update({ id }, { status: 'received' });
      }
    }`,
    fails: true
  },
  {
    label: 'a column of a loaded row written by a helper keyed only on the id',
    source: `class S {
      async sweep() {
        const stuck = await this.repository.find({ where: { status: 'received' } });
        for (const row of stuck) await this.recordFailure(row);
      }
      private async recordFailure(row: Event) {
        const attempts = row.attempts + 1;
        await this.repository.update({ id: row.id }, attempts > 5 ? { attempts, status: 'dead' } : { attempts });
      }
    }`,
    fails: true
  },
  {
    label: 'an update that carries the read value in its where',
    source: `class S {
      async replay(id: string) {
        const event = await this.repository.findOne({ where: { id } });
        if (event.status !== 'dead_letter') throw notReplayable();
        const { affected } = await this.repository.update({ id, status: 'dead_letter' }, { status: 'received' });
        if (affected !== 1) throw notReplayable();
      }
    }`,
    fails: false
  },
  {
    label: 'a read of one column, then an update keyed on the id of another',
    source: `class S {
      async touch(id: string) {
        const row = await this.repository.findOne({ where: { id } });
        if (row.status !== 'open') return;
        await this.repository.update({ id: row.id }, { seenAt: new Date() });
      }
    }`,
    fails: false
  },
  {
    label: 'a marked method',
    source: `class S {
      // race-checked: the caller holds a lock on the parent row
      async remove(id: string) {
        const row = await this.repository.findOneBy({ id });
        await this.repository.remove(row);
      }
    }`,
    fails: false
  }
];

function selfTest(): void {
  let failed = false;

  for (const c of SELF_TEST_CASES) {
    const problems = scanSource('self-test.ts', c.source, new Map());
    const ok = problems.length > 0 === c.fails;

    console.log(`${ok ? 'ok' : 'FAIL'}: ${c.label}`);
    failed ||= !ok;
  }

  if (failed) process.exit(1);
}

function main(): void {
  const exported = exportedKeyIndex();
  const files = listFiles(MODULES_DIR).filter((f) =>
    SCANNED_SUFFIXES.some((s) => f.endsWith(s))
  );
  const problems = files.flatMap((file) =>
    scanSource(
      path.relative(path.dirname(SRC_DIR), file).replaceAll('\\', '/'),
      fs.readFileSync(file, 'utf-8'),
      exported
    )
  );

  if (problems.length > 0) {
    console.error(`${problems.length} read-then-write race(s):`);

    for (const p of problems) console.error(`  - ${p}`);

    process.exit(1);
  }

  console.log(`No read-then-write race in ${files.length} files.`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  main();
}
