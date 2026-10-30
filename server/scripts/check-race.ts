/**
 * Finds two read-then-write races in the methods of the services and the
 * listeners under src/modules. A read is a `findOne*` or `exists*` call, or a
 * call of a method of the same file that makes one (a `loadRole(id)` helper).
 *
 * 1. A read, then a `delete`, `remove` or `softDelete` that does not decide
 *    from its own result: the method reads no `affected`, neither it nor a
 *    method of the same file that it calls takes a pessimistic lock, and the
 *    delete has no `where`. Of two concurrent requests, both
 *    pass the read, and both then act as if they removed the row.
 * 2. A read, then a throw of a key that refuses a duplicate (`*_EXISTS`,
 *    `ALREADY_*`), then a `save` or an `insert`, and no unique violation is
 *    caught (`isUniqueViolation`, `orIgnore`, `onConflict`) in the method or in
 *    a method of the same file that it calls. The unique index then refuses
 *    the loser of a race with another answer than the read check gives.
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
const DELETES = new Set(['delete', 'remove', 'softDelete']);
const WRITES = new Set(['save', 'insert']);
const UNIQUE_HANDLING = new Set([
  'isUniqueViolation',
  'orIgnore',
  'onConflict'
]);
const LOCKS = new Set(['lock', 'setLock']);
const DUPLICATE_KEY = /_EXISTS$|(^|_)ALREADY_/;
const MARKER = /\/\/\s*race-checked:\s*\S/;

type Body = ts.FunctionLikeDeclaration;

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
    const read = this.firstRead();
    if (read === undefined) return [];
    return [this.unguardedDelete(read), this.duplicateRead(read)].filter(
      (p): p is string => p !== undefined
    );
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
      .sort((a, b) => a - b)[0];
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
      path.relative(path.dirname(SRC_DIR), file).replace(/\\/g, '/'),
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
