/**
 * Refuses a RegExp modifier group such as `(?i:...)` in `shared/src`.
 *
 * Modifiers are ES2025 syntax. Safari before 26 throws a SyntaxError on them,
 * and `client/.browserslistrc` supports Safari 18.4. The client compiles
 * `shared/src`, but no gate sees a modifier there: TypeScript accepts it at any
 * target, the client build copies the literal as it is, and ESLint does not
 * lint `shared/`. The client ESLint config refuses the same pattern in
 * `client/`.
 *
 * Checks regex literals and the first string argument of `new RegExp(...)`
 * and `RegExp(...)`. A `(?:` group has no flag and is allowed.
 *
 * Usage (from server/): npm run check:regex-modifiers
 *        npm run check:regex-modifiers -- --self-test
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';

const SHARED_SRC = path.resolve(__dirname, '../../shared/src');
const MODIFIER = /(?<!\\)\(\?(?:[ims]+-?[ims]*|-[ims]+):/;
const SKIP_DIRS = new Set(['node_modules', 'dist']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }

  return out;
}

function patternOf(node: ts.Node): string | undefined {
  if (ts.isRegularExpressionLiteral(node)) {
    return node.text.slice(1, node.text.lastIndexOf('/'));
  }

  if (
    (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'RegExp'
  ) {
    const first = node.arguments?.[0];

    if (first && ts.isStringLiteralLike(first)) return first.text;
  }

  return undefined;
}

function scan(root: string): string[] {
  const violations: string[] = [];

  for (const file of walk(root)) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const visit = (node: ts.Node): void => {
      const pattern = patternOf(node);

      if (pattern !== undefined && MODIFIER.test(pattern)) {
        const { line } = source.getLineAndCharacterOfPosition(
          node.getStart(source)
        );

        violations.push(`${path.relative(root, file)}:${line + 1}`);
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return violations;
}

function selfTest(): void {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-regex-modifiers-'));

  try {
    fs.writeFileSync(
      path.join(base, 'planted.ts'),
      [
        'export const p1 = /(?i:a)b/;',
        'export const p2 = /(?-i:a)/i;',
        "export const p3 = new RegExp('(?im-s:a)');",
        "export const p4 = RegExp('a(?m:^b)');",
        'export const n1 = /(?:a)(?<n>b)(?=c)(?<!d)/;',
        'export const n2 = /\\(?i:/;',
        "export const n3 = 'text (?i:x) in a string';",
        '// a comment that names (?i:x)'
      ].join('\n')
    );
    const found = scan(base).map((v) => v.split(':').at(-1));
    const expected = ['1', '2', '3', '4'];

    if (found.join(',') !== expected.join(',')) {
      console.error(
        `ERROR: check-regex-modifiers self-test failed: expected lines ${expected.join(', ')}, got ${found.join(', ') || 'none'}.`
      );
      process.exit(1);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }

  console.log('check-regex-modifiers: self-test OK.');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const violations = scan(SHARED_SRC);

  if (violations.length > 0) {
    console.error(
      'ERROR: a RegExp modifier group in shared/src. Safari before 26 cannot parse it, and the client supports Safari 18.4. Use a flag on the whole pattern or a character class:\n' +
        violations.map((v) => `  shared/src/${v}`).join('\n')
    );
    process.exit(1);
  }

  console.log('check-regex-modifiers: no RegExp modifier in shared/src.');
}
