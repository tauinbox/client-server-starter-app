/**
 * Config check: the client nginx access log must never record a query string
 * or a Referer. The mailed verify-email, reset-password and
 * confirm-email-change links carry their one-time token in `?token=`, and the
 * server stores those tokens only as hashes, so a plain-text copy in the log is
 * a weaker store than the database. The stock `main` format logs `$request`
 * (the full request line) and `$http_referer` (which repeats the token URL on
 * every same-origin request the page makes afterwards).
 *
 * Enforces, for `client/nginx.conf`:
 *   1. Every `server` block sets `access_log <path> nexus_redacted` at its own
 *      level, so each location inherits it.
 *   2. Every `access_log` anywhere in the file uses `nexus_redacted` or `off`.
 *   3. `log_format nexus_redacted` is defined, and no `log_format` references a
 *      variable that holds the query string or the Referer.
 *   4. `$nexus_log_path` is mapped from `$request_uri` with the query cut off.
 *
 * `--self-test` runs the detectors against synthetic configs and fails if any
 * of them stays silent, so a check that has stopped detecting cannot pass.
 *
 * Exit code 1 if violations found.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONF = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'nginx.conf'
);

const FORMAT = 'nexus_redacted';

// `$request` must not match `$request_method`, hence the lookahead.
const FORBIDDEN_VARS =
  /\$(?:request|request_uri|request_body|args|query_string|http_referer|arg_\w+)(?!\w)/g;

const PATH_MAP =
  /map\s+\$request_uri\s+\$nexus_log_path\s*\{\s*"~\^\(\?<p>\[\^\?\]\*\)"\s+\$p\s*;\s*\}/;

/**
 * Splits the config into directives and blocks, dropping comments. Quoted
 * strings are kept intact, so a `#`, `;` or brace inside quotes is not
 * structure. Returns a tree of { name, args, children? } nodes.
 */
function parse(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === '#') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '{' || c === '}' || c === ';') {
      tokens.push(c);
      i++;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      tokens.push(text.slice(i, j + 1));
      i = j + 1;
    } else {
      let j = i;
      while (j < text.length && !/[\s{};"'#]/.test(text[j])) j++;
      tokens.push(text.slice(i, j));
      i = j;
    }
  }

  let pos = 0;
  function block() {
    const nodes = [];
    let words = [];
    while (pos < tokens.length) {
      const t = tokens[pos++];
      if (t === ';') {
        if (words.length) nodes.push({ name: words[0], args: words.slice(1) });
        words = [];
      } else if (t === '{') {
        nodes.push({ name: words[0], args: words.slice(1), children: block() });
        words = [];
      } else if (t === '}') {
        return nodes;
      } else {
        words.push(t);
      }
    }
    return nodes;
  }
  return block();
}

function* walk(nodes) {
  for (const node of nodes) {
    yield node;
    if (node.children) yield* walk(node.children);
  }
}

function analyse(text) {
  const violations = [];
  const all = [...walk(parse(text))];

  const servers = all.filter((n) => n.name === 'server' && n.children);
  if (!servers.length) violations.push('no `server` block found');
  servers.forEach((server, index) => {
    const own = server.children.find(
      (n) => n.name === 'access_log' && !n.children
    );
    if (!own || own.args[1] !== FORMAT) {
      violations.push(
        `server block #${index + 1} has no \`access_log <path> ${FORMAT}\` at its own level`
      );
    }
  });

  for (const n of all.filter((n) => n.name === 'access_log')) {
    const off = n.args[0] === 'off';
    if (!off && n.args[1] !== FORMAT) {
      violations.push(
        `\`access_log ${n.args.join(' ')}\` does not use the ${FORMAT} format`
      );
    }
  }

  const formats = all.filter((n) => n.name === 'log_format');
  if (!formats.some((n) => n.args[0] === FORMAT)) {
    violations.push(`\`log_format ${FORMAT}\` is not defined`);
  }
  for (const n of formats) {
    const leaks = [...new Set(n.args.slice(1).join(' ').match(FORBIDDEN_VARS))];
    if (leaks.length) {
      violations.push(
        `\`log_format ${n.args[0]}\` logs ${leaks.join(', ')}, which can hold a token`
      );
    }
  }

  const withoutComments = text.replace(/^\s*#.*$/gm, '');
  if (!PATH_MAP.test(withoutComments)) {
    violations.push(
      '`$nexus_log_path` is not mapped from `$request_uri` with the query cut off'
    );
  }

  return violations;
}

function selfTest() {
  const MAP = 'map $request_uri $nexus_log_path { "~^(?<p>[^?]*)" $p; }';
  const FMT = `log_format ${FORMAT} '$remote_addr "$request_method $nexus_log_path $server_protocol" $status';`;
  const GOOD = `${MAP}\n${FMT}\nserver {\n  access_log /var/log/nginx/access.log ${FORMAT};\n  location / { root /x; }\n}\n`;

  const cases = [
    ['a config with no access_log (image default)', 'server { location / {} }'],
    [
      'a server-level access_log with the stock format',
      GOOD.replace(`access.log ${FORMAT}`, 'access.log main')
    ],
    [
      'a location that overrides the format',
      GOOD.replace('root /x;', 'root /x; access_log /dev/stdout combined;')
    ],
    [
      'a format that logs $request',
      GOOD.replace('$request_method', '$request')
    ],
    [
      'a format that logs $http_referer',
      GOOD.replace('$status', '$status "$http_referer"')
    ],
    ['a format that logs $args', GOOD.replace('$status', '$status $args')],
    [
      'a format that logs $request_uri',
      GOOD.replace('$nexus_log_path', '$request_uri')
    ],
    ['a format that logs $arg_token', GOOD.replace('$status', '$arg_token')],
    [
      'a missing nexus_redacted format',
      GOOD.replace(FMT, '').replace(`access.log ${FORMAT}`, 'access.log main')
    ],
    ['a path map that keeps the query', GOOD.replace('[^?]*', '.*')],
    ['a commented-out path map', GOOD.replace(MAP, `# ${MAP}`)],
    [
      'a second server block without access_log',
      `${GOOD}server { listen 81; }\n`
    ]
  ];

  const failures = [];
  const goodViolations = analyse(GOOD);
  if (goodViolations.length) {
    failures.push(`a compliant config was rejected: ${goodViolations[0]}`);
  }
  // `off` is allowed in a location, but the server level must keep a log.
  if (
    analyse(GOOD.replace(`/var/log/nginx/access.log ${FORMAT}`, 'off'))
      .length !== 1
  ) {
    failures.push('`access_log off` at server level was not reported once');
  }
  if (
    analyse(GOOD.replace('root /x;', 'root /x; access_log off;')).length !== 0
  ) {
    failures.push('`access_log off` inside a location was rejected');
  }
  if (analyse(`# "#" ; {\n${GOOD}`).length !== 0) {
    failures.push('a comment with structural characters broke the parser');
  }
  for (const [label, text] of cases) {
    if (analyse(text).length === 0) failures.push(label);
  }

  if (failures.length) {
    console.error(
      'ERROR: check-nginx-log-redaction self-test failed. Not detected:\n'
    );
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(
    `check-nginx-log-redaction: self-test OK, ${cases.length} leaky configs rejected.`
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const violations = analyse(readFileSync(CONF, 'utf-8'));
  if (violations.length) {
    console.error(
      'ERROR: client/nginx.conf can write a token into the access log:\n'
    );
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log('check-nginx-log-redaction: OK, the access log is redacted.');
}
