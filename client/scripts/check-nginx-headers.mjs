/**
 * Config check: every response of the client nginx must carry the security
 * headers, HSTS included. nginx drops every inherited `add_header` in a block
 * that sets one of its own, so a header set only at `server` level silently
 * disappears from a `location` that adds a `Cache-Control`.
 *
 * Enforces, for `client/nginx.conf`: every `server` and `location` block
 * (and any nested block) resolves to the full REQUIRED set, each with
 * `always`, and HSTS has a max-age of at least one year. The resolution
 * follows `add_header_inherit` as nginx applies it, measured on the pinned
 * image:
 *   on (default)  inherit the parent set only when the block sets none
 *   merge         the block set plus the parent set
 *   off           the block set only
 * The mode itself is inherited by nested blocks.
 *
 * `--self-test` runs the detector against synthetic configs and fails if it
 * stays silent, so a check that has stopped detecting cannot pass.
 *
 * Exit code 1 if violations found.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, unquote } from './nginx-conf.mjs';

const CONF = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'nginx.conf'
);

const REQUIRED = [
  'content-security-policy',
  'permissions-policy',
  'referrer-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options'
];

const HSTS_MIN_MAX_AGE = 31536000;

const CHECKED_BLOCKS = new Set(['server', 'location', 'if']);

function resolveHeaders(node, parentHeaders, parentMode) {
  const own = node.children
    .filter((n) => n.name === 'add_header' && !n.children)
    .map((n) => ({
      name: unquote(n.args[0] ?? '').toLowerCase(),
      value: unquote(n.args[1] ?? ''),
      always: n.args[2] === 'always'
    }));
  const modeNode = node.children.find((n) => n.name === 'add_header_inherit');
  const mode = modeNode ? modeNode.args[0] : parentMode;

  let headers;
  if (mode === 'off') headers = own;
  else if (mode === 'merge') headers = [...own, ...parentHeaders];
  else headers = own.length ? own : parentHeaders;
  return { headers, mode };
}

function analyse(text) {
  const violations = [];
  let servers = 0;

  function visit(node, parentHeaders, parentMode, label) {
    const { headers, mode } = resolveHeaders(node, parentHeaders, parentMode);
    for (const name of REQUIRED) {
      const found = headers.filter((h) => h.name === name);
      if (!found.length) {
        violations.push(`${label} answers without \`${name}\``);
      } else if (!found.every((h) => h.always)) {
        violations.push(
          `${label} sets \`${name}\` without \`always\`, so error responses lose it`
        );
      }
    }
    for (const h of headers.filter(
      (h) => h.name === 'strict-transport-security'
    )) {
      const maxAge = Number(/max-age=(\d+)/i.exec(h.value)?.[1] ?? 0);
      if (maxAge < HSTS_MIN_MAX_AGE) {
        violations.push(
          `${label} sets an HSTS max-age below ${HSTS_MIN_MAX_AGE}: "${h.value}"`
        );
      }
    }
    for (const child of node.children) {
      if (child.children && CHECKED_BLOCKS.has(child.name)) {
        visit(
          child,
          headers,
          mode,
          `\`${child.name} ${child.args.join(' ')}\``
        );
      }
    }
  }

  for (const node of parse(text)) {
    if (node.name === 'server' && node.children) {
      servers++;
      visit(node, [], 'on', `server block #${servers}`);
    }
  }
  if (!servers) violations.push('no `server` block found');
  return violations;
}

function selfTest() {
  const HEADERS = [
    'add_header X-Content-Type-Options "nosniff" always;',
    'add_header X-Frame-Options "DENY" always;',
    'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
    'add_header Permissions-Policy "camera=()" always;',
    'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
    `add_header Content-Security-Policy "default-src 'self'" always;`
  ].join('\n  ');
  const CACHE = 'add_header Cache-Control "no-cache" always;';
  const GOOD = `server {\n  add_header_inherit merge;\n  ${HEADERS}\n  location / { ${CACHE} }\n  location /api/ { proxy_pass http://b; }\n}\n`;
  // The layout this file used before merge: the full set repeated per block.
  const REPEATED = `server {\n  ${HEADERS}\n  location / { ${CACHE}\n  ${HEADERS} }\n}\n`;

  const cases = [
    ['a config with no headers', 'server { location / {} }'],
    [
      'a missing HSTS header',
      GOOD.replace(/add_header Strict-Transport-Security [^\n]*/, '')
    ],
    [
      'a commented-out HSTS header',
      GOOD.replace('add_header Strict', '# add_header Strict')
    ],
    [
      'a location that drops the inherited set (no merge)',
      GOOD.replace('add_header_inherit merge;', '')
    ],
    [
      'a location that sets add_header_inherit off',
      GOOD.replace(
        'location /api/ {',
        'location /api/ { add_header_inherit off;'
      )
    ],
    [
      'a nested location that switches back to on',
      GOOD.replace(
        `location / { ${CACHE} }`,
        `location / { add_header_inherit on; ${CACHE} }`
      )
    ],
    [
      'a repeated set that forgot HSTS in one location',
      REPEATED.replace(
        /(location[^\n]*\n[\s\S]*?)add_header Strict-Transport-Security [^\n]*/,
        '$1'
      )
    ],
    [
      'HSTS without always',
      GOOD.replace('includeSubDomains" always', 'includeSubDomains"')
    ],
    [
      'an HSTS max-age below a year',
      GOOD.replace('max-age=31536000', 'max-age=300')
    ],
    ['a second server block with no headers', `${GOOD}server { listen 81; }\n`]
  ];

  const failures = [];
  for (const [label, text] of [
    ['the merge layout', GOOD],
    ['the repeated layout', REPEATED]
  ]) {
    const v = analyse(text);
    if (v.length) failures.push(`${label} was rejected: ${v[0]}`);
  }
  for (const [label, text] of cases) {
    if (analyse(text).length === 0) failures.push(`not detected: ${label}`);
  }

  if (failures.length) {
    console.error('ERROR: check-nginx-headers self-test failed:\n');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(
    `check-nginx-headers: self-test OK, ${cases.length} configs without the full header set rejected.`
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const violations = analyse(readFileSync(CONF, 'utf-8'));
  if (violations.length) {
    console.error(
      'ERROR: client/nginx.conf serves a response without a security header:\n'
    );
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log(
    'check-nginx-headers: OK, every block carries the security headers.'
  );
}
