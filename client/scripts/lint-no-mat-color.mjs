/**
 * Unconditional ban on the M2 `color="primary|accent|warn"` attribute in
 * Angular Material templates. The project uses an M3 theme (`mat.theme(...)`
 * in `styles/themes/_light.scss`) where this attribute is a silent no-op.
 *
 * Use one of:
 *   - drop the attribute (primary is the default in M3)
 *   - apply class="app-btn-danger" for destructive buttons
 *   - apply class="app-chip-danger" for destructive chips
 *
 * See `styles/components/_buttons.scss` and `_chips.scss`.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

const PATTERN = /\bcolor="(?:primary|accent|warn)"/;

const output = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '*.html'],
  { cwd: srcDir, encoding: 'utf-8' }
);
const files = output
  .split('\n')
  .filter(Boolean)
  .filter((f) => f.startsWith('app/'));

const violations = [];
for (const rel of files) {
  const lines = readFileSync(resolve(srcDir, rel), 'utf-8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (PATTERN.test(lines[i])) {
      violations.push(`${rel.replaceAll('\\', '/')}:${i + 1}: ${lines[i].trim()}`);
    }
  }
}

if (violations.length > 0) {
  console.error(
    'ERROR: M2-style color="primary|accent|warn" attribute detected.\n' +
      'M3 themes do not honour this attribute (silent no-op). Use one of:\n' +
      '  - drop the attribute (primary is the default)\n' +
      '  - apply class="app-btn-danger" for destructive buttons\n' +
      '  - apply class="app-chip-danger" for destructive chips\n'
  );
  for (const v of violations) {
    console.error(`  ${v}`);
  }
  process.exit(1);
}
