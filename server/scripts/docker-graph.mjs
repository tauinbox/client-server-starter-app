/**
 * Draws the Docker layout of the repository from its files, for
 * `architecture/docker-graph.md`. `dependency-graph.mjs` writes and checks the
 * file together with the import graph.
 *
 * Inputs, all read from the working tree:
 * - the compose files (services, networks, volumes, ports, start order);
 * - the configs that name another container: the nginx config that a
 *   Dockerfile copies into an image, and the Prometheus and Grafana files that
 *   a service mounts;
 * - the Dockerfiles, the `.dockerignore` files and the entrypoint script;
 * - the egress lists of `shared/` and the `*_URL` constants of `server/src`;
 * - the Deploy workflow, and the CI steps that start or build containers.
 *
 * Nothing that names one host (an address, a domain, a neighbour service) is
 * in these inputs, so the output stays valid for each host and each cell.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { parse as parseYaml } from 'yaml';

import {
  parse as parseNginx,
  unquote,
  walk
} from '../../client/scripts/nginx-conf.mjs';
// A deep path: Node runs this file without the `@app/shared` alias, and the
// barrel imports its siblings without a file extension, which Node refuses.
import {
  REGION_INTEGRATIONS,
  REGIONS,
  integrationRegions
} from '../../shared/src/constants/data-region.constants.ts';

const PROD_COMPOSE = 'docker-compose.yml';
const DEV_COMPOSE = 'server/docker-compose.yml';
const DEV_ENV_EXAMPLE = 'server/.env.example';
const DEPLOY_WORKFLOW = '.github/workflows/deploy.yml';
const CI_WORKFLOW = '.github/workflows/ci.yml';
const CELLS = [
  { label: 'intl (CELL unset)', env: { CELL: undefined } },
  { label: 'ru (CELL=ru)', env: { CELL: 'ru' } }
];
const HOME_CELL = CELLS[0].env;

let ROOT = '';

function read(file) {
  return readFileSync(join(ROOT, file), 'utf8').replaceAll('\r\n', '\n');
}

function trackedFiles(pattern) {
  return execFileSync('git', ['ls-files', '--', pattern], {
    cwd: ROOT,
    encoding: 'utf8'
  })
    .split('\n')
    .filter(Boolean);
}

// --- compose variable interpolation -----------------------------------------

function closingBrace(text, start) {
  let depth = 0;

  for (let i = start; i < text.length; i++) {
    if (text.startsWith('${', i)) {
      depth++;
      i++;
    } else if (text[i] === '}') {
      depth--;

      if (depth === 0) return i;
    }
  }

  return text.length;
}

function expand(body, { env, raw }) {
  const match = /^([A-Za-z_]\w*)(?:(:?[-+])([\s\S]*))?$/.exec(body);

  if (!match || !Object.hasOwn(env, match[1])) return raw;

  const [, name, op, word = ''] = match;
  const value = env[name];
  const isSet = value !== undefined;
  const nonEmpty = isSet && value !== '';

  switch (op) {
    case ':-':
      return nonEmpty ? value : interpolate(word, env);
    case '-':
      return isSet ? value : interpolate(word, env);
    case ':+':
      return nonEmpty ? interpolate(word, env) : '';
    case '+':
      return isSet ? interpolate(word, env) : '';
    default:
      return value ?? '';
  }
}

/**
 * Resolves `${VAR}`, `${VAR:-x}`, `${VAR-x}`, `${VAR:+x}` and `${VAR+x}` for
 * the variables that `env` names, nested forms included. A reference to any
 * other variable stays as written, because its value lives in an env file
 * that is not in the repository.
 */
function interpolate(text, env) {
  let out = '';
  let i = 0;

  while (i < text.length) {
    const start = text.indexOf('${', i);

    if (start === -1) {
      out += text.slice(i);
      break;
    }

    const end = closingBrace(text, start);

    out += text.slice(i, start);
    out += expand(text.slice(start + 2, end), {
      env,
      raw: text.slice(start, end + 1)
    });
    i = end + 1;
  }

  return out;
}

// --- Mermaid helpers --------------------------------------------------------

function nodeId(prefix, name) {
  return `${prefix}_${name}`.replaceAll(/\W/g, '_');
}

function workflowVars(value) {
  return String(value).replaceAll(/\$\{\{\s*[\w.]*?(\w+)\s*\}\}/g, '<$1>');
}

/** Splits on `separator` outside `${...}`, so a default value keeps its colon. */
function splitOutside(value, separator) {
  const parts = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < value.length; i++) {
    if (value.startsWith('${', i)) depth++;

    if (value[i] === '}' && depth > 0) depth--;

    if (value[i] === separator && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += value[i];
    }
  }

  parts.push(current);

  return parts;
}

function text(value) {
  return String(value)
    .replaceAll('"', '#quot;')
    .replaceAll('<', '#lt;')
    .replaceAll('>', '#gt;');
}

function label(...lines) {
  return `"${lines.filter(Boolean).map(text).join('<br/>')}"`;
}

function edge(from, to, { kind = '-->', note } = {}) {
  return note
    ? `${from} ${kind}|"${text(note)}"| ${to}`
    : `${from} ${kind} ${to}`;
}

function mermaid(lines) {
  return ['```mermaid', ...lines, '```'];
}

function table(head, rows) {
  const cell = (value) =>
    String(value ?? '')
      .replaceAll('|', '\\|')
      .replaceAll('\n', ' ');

  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)
  ];
}

function code(value) {
  return value === undefined || value === '' ? '' : `\`${value}\``;
}

// --- compose model ----------------------------------------------------------

function listOf(value) {
  if (value === undefined || value === null) return [];

  return Array.isArray(value) ? value : [value];
}

function envEntries(environment) {
  if (Array.isArray(environment)) {
    return environment.map((entry) => {
      const at = String(entry).indexOf('=');

      return at === -1
        ? [String(entry), '']
        : [entry.slice(0, at), entry.slice(at + 1)];
    });
  }

  return Object.entries(environment ?? {}).map(([key, value]) => [
    key,
    value === null ? '' : String(value)
  ]);
}

function dependsOn(service) {
  const { depends_on: deps } = service;

  if (Array.isArray(deps)) {
    return deps.map((name) => ({ name, condition: 'service_started' }));
  }

  return Object.entries(deps ?? {}).map(([name, value]) => ({
    name,
    condition: value?.condition ?? 'service_started'
  }));
}

function serviceNetworks(service) {
  const { networks } = service;

  if (networks === undefined) return [{ name: 'default', aliases: [] }];

  if (Array.isArray(networks)) {
    return networks.map((name) => ({ name, aliases: [] }));
  }

  return Object.entries(networks).map(([name, value]) => ({
    name,
    aliases: listOf(value?.aliases)
  }));
}

function parsePort(spec, env) {
  const parts = splitOutside(interpolate(String(spec), env), ':');
  const target = parts.pop();
  const published = parts.pop();

  return { ip: parts.join(':') || '0.0.0.0', published, target };
}

function parseMount(spec) {
  if (typeof spec === 'object') {
    return {
      source: spec.source,
      target: spec.target,
      bind: spec.type === 'bind',
      readOnly: Boolean(spec.read_only)
    };
  }

  const [source, target, mode] = String(spec).split(':');

  return {
    source,
    target,
    bind: /^[./~]/.test(source),
    readOnly: mode === 'ro'
  };
}

function healthSummary(service) {
  const test = listOf(service.healthcheck?.test);

  if (test.length === 0) return '';

  const command = test.slice(1).join(' ');
  const url = /https?:\/\/[^\s'"]+/.exec(command)?.[0];

  return url ? `GET ${new URL(url).pathname}` : command.split('||')[0].trim();
}

function loadCompose(file, env) {
  const doc = parseYaml(read(file));
  const services = Object.entries(doc.services ?? {}).map(([name, svc]) => ({
    name,
    svc,
    build: svc.build
      ? {
          context: svc.build.context ?? '.',
          dockerfile: posix.join(
            svc.build.context ?? '.',
            svc.build.dockerfile ?? 'Dockerfile'
          )
        }
      : undefined,
    env: envEntries(svc.environment),
    ports: listOf(svc.ports).map((spec) => parsePort(spec, env)),
    expose: listOf(svc.expose).map(String),
    mounts: listOf(svc.volumes).map(parseMount),
    networks: serviceNetworks(svc),
    deps: dependsOn(svc)
  }));

  return {
    file,
    doc,
    name: doc.name ? interpolate(String(doc.name), env) : undefined,
    services,
    serviceNames: new Set(services.map(({ name }) => name))
  };
}

function hostOf(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

// --- config files that name another container -------------------------------

function nginxLinks(file, serviceNames) {
  const tree = parseNginx(read(file));
  const upstreams = new Map();
  const links = [];
  const csp = [];

  for (const node of walk(tree)) {
    if (node.name === 'upstream' && node.children) {
      const servers = node.children
        .filter(({ name }) => name === 'server')
        .map(({ args }) => args[0]);

      upstreams.set(node.args[0], servers);
    }

    if (
      node.name === 'add_header' &&
      /content-security-policy/i.test(node.args[0])
    ) {
      csp.push(unquote(node.args[1]));
    }
  }

  for (const node of walk(tree)) {
    if (node.name !== 'location' || !node.children) continue;

    const pass = node.children.find(({ name }) => name === 'proxy_pass');

    if (!pass) continue;

    const target = pass.args[0]
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
    const servers = upstreams.get(target) ?? [target];

    for (const server of servers) {
      const [host] = server.split(':');

      if (serviceNames.has(host)) {
        links.push({
          to: host,
          path: node.args.at(-1),
          via: upstreams.has(target) ? `upstream ${target}` : 'proxy_pass'
        });
      }
    }
  }

  return { links, csp: csp[0] };
}

function prometheusLinks(file, serviceNames) {
  const doc = parseYaml(read(file));

  return listOf(doc.scrape_configs).flatMap((job) =>
    listOf(job.static_configs)
      .flatMap(({ targets }) => listOf(targets))
      .map((target) => ({ target, host: String(target).split(':')[0] }))
      .filter(({ host }) => serviceNames.has(host))
      .map(({ target, host }) => ({
        to: host,
        note: `scrape ${job.job_name}: ${target}${job.metrics_path ?? '/metrics'}`
      }))
  );
}

function grafanaLinks(dir, serviceNames) {
  const links = [];
  const receivers = [];

  for (const file of trackedFiles(`${dir}/datasources`)) {
    for (const source of listOf(parseYaml(read(file)).datasources)) {
      const host = hostOf(source.url);

      if (serviceNames.has(host)) {
        links.push({
          to: host,
          note: `datasource ${source.name}: ${source.url}`
        });
      }
    }
  }

  for (const file of trackedFiles(`${dir}/alerting`)) {
    for (const point of listOf(parseYaml(read(file)).contactPoints)) {
      for (const receiver of listOf(point.receivers)) {
        const url = receiver.settings?.url;

        if (url) receivers.push({ name: point.name, type: receiver.type, url });
      }
    }
  }

  return { links, receivers };
}

// --- Dockerfiles ------------------------------------------------------------

function instructions(file) {
  const joined = read(file)
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
    .replaceAll(/\s*\\\n\s*/g, ' ');

  return joined
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [, op, rest] = /^(\S+)\s*(.*)$/.exec(line);

      return { op: op.toUpperCase(), rest };
    });
}

function baseImage(ref) {
  const [name, digest] = ref.split('@');

  return { name, pinned: Boolean(digest) };
}

function copyArgs(rest) {
  const tokens = rest.split(/\s+/);
  const from = tokens.find((t) => t.startsWith('--from='))?.slice(7);
  const paths = tokens.filter((t) => !t.startsWith('--'));
  const target = paths.pop();

  return { from, sources: paths, target };
}

function parseDockerfile(file) {
  const stages = [];

  for (const { op, rest } of instructions(file)) {
    if (op === 'FROM') {
      const [ref, , alias] = rest.split(/\s+/);

      stages.push({
        name: alias ?? `stage${stages.length}`,
        base: ref,
        steps: []
      });
    } else {
      stages.at(-1)?.steps.push({ op, rest });
    }
  }

  return stages;
}

function downloads(rest) {
  return [...rest.matchAll(/https?:\/\/[^\s"'\\]+/g)].map(([url]) => url);
}

function entrypointSteps(stage) {
  const entry = stage.steps.find(
    ({ op }) => op === 'ENTRYPOINT' || op === 'CMD'
  );

  if (!entry) return [];

  const script = /\.\/?([\w.-]+\.sh)/.exec(entry.rest)?.[1];
  const copy = stage.steps
    .filter(({ op }) => op === 'COPY')
    .map(({ rest }) => copyArgs(rest))
    .find(
      ({ from, sources }) =>
        !from && sources.some((s) => s.endsWith(`/${script}`))
    );

  if (!script || !copy) return [entry.rest];

  return read(copy.sources[0])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^(#|set |echo )/.test(line));
}

// --- egress lists -----------------------------------------------------------

function urlConstants() {
  const out = execFileSync(
    'git',
    [
      'grep',
      '-hE',
      String.raw`const [A-Z_]*URL = '?https://`,
      '--',
      'server/src',
      ':!*.spec.ts'
    ],
    { cwd: ROOT, encoding: 'utf8' }
  );

  return out
    .split('\n')
    .map((line) => /const ([A-Z_]*URL) = '(https:\/\/[^'/]+)/.exec(line))
    .filter(Boolean)
    .map(([, name, url]) => ({ name, host: new URL(url).hostname }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

function egressNodes() {
  const constants = urlConstants();
  const nodes = REGION_INTEGRATIONS.map((key) => {
    const regions = integrationRegions(key);
    const prefix = key.replace(/OAuth$/, '').toUpperCase();
    const hosts = constants.filter(({ name }) => name.startsWith(`${prefix}_`));

    return {
      id: nodeId('ext', key),
      lines: [
        key,
        `regions: ${regions.join(', ')}`,
        ...hosts.map(({ host }) => host)
      ],
      claimed: hosts.map(({ name }) => name)
    };
  });
  const claimed = new Set(nodes.flatMap(({ claimed: names }) => names));

  nodes.push({
    id: nodeId('ext', 'smtp'),
    lines: [
      'SMTP provider (SMTP_HOST)',
      ...Object.entries(REGIONS).map(
        ([cell, { smtpProviderRegions }]) =>
          `${cell} cell accepts: ${smtpProviderRegions.join(', ')}`
      )
    ]
  });

  for (const { name, host } of constants) {
    if (!claimed.has(name))
      nodes.push({ id: nodeId('ext', name), lines: [host, name] });
  }

  return nodes;
}

function cspHosts(policy) {
  if (!policy) return [];

  return policy
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .filter(([directive]) => directive)
    .flatMap(([directive, ...sources]) =>
      sources
        .filter((source) => /^https:\/\//.test(source))
        .map((source) => ({ directive, host: new URL(source).hostname }))
    );
}

// --- section: production ----------------------------------------------------

function configLinks(compose) {
  const links = [];
  const receivers = [];
  let csp;

  for (const service of compose.services) {
    for (const [key, value] of service.env) {
      const host = hostOf(value);

      if (host !== service.name && compose.serviceNames.has(host)) {
        links.push({ from: service.name, to: host, note: `${key}=${value}` });
      }
    }

    for (const mount of service.mounts.filter(({ bind }) => bind)) {
      const source = posix.normalize(mount.source);

      if (/prometheus\.ya?ml$/.test(source)) {
        for (const link of prometheusLinks(source, compose.serviceNames)) {
          links.push({ from: service.name, ...link });
        }
      } else if (existsSync(join(ROOT, source, 'datasources'))) {
        const grafana = grafanaLinks(source, compose.serviceNames);

        links.push(
          ...grafana.links.map((link) => ({ from: service.name, ...link }))
        );
        receivers.push(
          ...grafana.receivers.map((r) => ({ from: service.name, ...r }))
        );
      }
    }

    if (!service.build) continue;

    for (const stage of parseDockerfile(service.build.dockerfile)) {
      for (const { op, rest } of stage.steps) {
        if (op !== 'COPY') continue;

        const { from, sources } = copyArgs(rest);
        const conf = sources.find((s) => s.endsWith('.conf'));

        if (from || !conf) continue;

        const nginx = nginxLinks(conf, compose.serviceNames);

        csp = nginx.csp;

        for (const { to, path, via } of nginx.links) {
          links.push({ from: service.name, to, note: `nginx ${via}: ${path}` });
        }
      }
    }
  }

  return { links, receivers, csp };
}

function serviceLabel(service) {
  const image = service.svc.image ?? '(build only)';
  const listens = [
    ...service.expose.map((port) => `listens ${port}`),
    ...service.ports.map(({ target }) => `listens ${target}`)
  ];

  return label(service.name, image, [...new Set(listens)].join(', '));
}

function productionTopology(compose, config) {
  const lines = ['flowchart LR'];
  const external = compose.doc.networks ?? {};
  const proxyNetworks = Object.entries(external).filter(([, n]) => n?.external);
  const webhookKeys = compose.services.flatMap(({ name, env }) =>
    env
      .filter(([key]) => /WEBHOOK.*ALLOWLIST/.test(key))
      .map(([key]) => ({ name, key }))
  );

  lines.push(`  browser(["Browser"])`);

  for (const [key, network] of proxyNetworks) {
    lines.push(
      `  ${nodeId('net', key)}[${label(
        'Reverse proxy of the host (not in this repository)',
        `TLS; joins the external network ${interpolate(String(network.name ?? key), HOME_CELL)}`
      )}]`,
      `  browser -->|"HTTPS"| ${nodeId('net', key)}`
    );
  }

  lines.push(
    `  subgraph project[${label(`Compose project ${compose.name}, network default`)}]`
  );

  for (const service of compose.services) {
    lines.push(`    ${nodeId('svc', service.name)}[${serviceLabel(service)}]`);
  }

  lines.push('  end');

  for (const service of compose.services) {
    for (const { name, aliases } of service.networks) {
      if (!Object.hasOwn(external, name)) continue;

      const alias = aliases
        .map((a) => interpolate(String(a), HOME_CELL))
        .join(', ');

      lines.push(
        `  ${edge(nodeId('net', name), nodeId('svc', service.name), {
          kind: '<-->',
          note: alias
            ? `network ${name}, alias ${alias}`
            : `network ${name}, no alias`
        })}`
      );
    }

    for (const { ip, published, target } of service.ports) {
      const host = nodeId('host', ip);

      lines.push(
        `  ${host}[${label(`Host ${ip}`)}]`,
        `  ${edge(host, nodeId('svc', service.name), { note: `${published} to ${target}` })}`
      );
    }
  }

  for (const { from, to, note } of config.links) {
    lines.push(`  ${edge(nodeId('svc', from), nodeId('svc', to), { note })}`);
  }

  for (const { from, name, type, url } of config.receivers) {
    const id = nodeId('recv', name);

    lines.push(
      `  ${id}[${label(`Alert receiver ${name} (${type})`, url)}]`,
      `  ${edge(nodeId('svc', from), id, { note: 'alert notification' })}`
    );
  }

  const egressFrom = compose.services.find(
    ({ build }) => build?.dockerfile === 'server/Dockerfile'
  );

  if (egressFrom) {
    lines.push(
      `  subgraph egress[${label('External services that the server calls')}]`
    );

    for (const { id, lines: nodeLines } of egressNodes()) {
      lines.push(`    ${id}[${label(...nodeLines)}]`);
    }

    lines.push(
      '  end',
      `  ${edge(nodeId('svc', egressFrom.name), 'egress', { note: 'HTTPS, SMTP' })}`
    );
  }

  for (const { name, key } of webhookKeys) {
    for (const [netKey] of proxyNetworks) {
      lines.push(
        `  webhooks[${label('Billing providers: webhook calls', `source IPs checked by ${key}`)}]`,
        `  ${edge('webhooks', nodeId('net', netKey), { note: `to ${name}` })}`
      );
    }
  }

  const hosts = cspHosts(config.csp);

  if (hosts.length > 0) {
    const byHost = Map.groupBy(hosts, ({ host }) => host);

    lines.push(
      `  subgraph browserext[${label('Third parties that the CSP lets the browser load')}]`
    );

    for (const [host, entries] of [...byHost].toSorted(([a], [b]) =>
      a.localeCompare(b)
    )) {
      lines.push(
        `    ${nodeId('csp', host)}[${label(host, entries.map(({ directive }) => directive).join(', '))}]`
      );
    }

    lines.push('  end', `  ${edge('browser', 'browserext', { kind: '-.->' })}`);
  }

  return mermaid(lines);
}

function startOrderAndStorage(compose) {
  const lines = ['flowchart TB'];
  const volumes = compose.doc.volumes ?? {};

  for (const service of compose.services) {
    lines.push(`  ${nodeId('svc', service.name)}[${label(service.name)}]`);
  }

  for (const service of compose.services) {
    for (const { name, condition } of service.deps) {
      lines.push(
        `  ${edge(nodeId('svc', service.name), nodeId('svc', name), {
          kind: '-.->',
          note: `starts after: ${condition.replace('service_', '')}`
        })}`
      );
    }

    for (const mount of service.mounts) {
      if (mount.bind) {
        const id = nodeId('bind', mount.source);

        lines.push(
          `  ${id}[/${label(`repo file ${posix.normalize(mount.source)}`)}/]`,
          `  ${edge(id, nodeId('svc', service.name), {
            note: `bind ${mount.target}${mount.readOnly ? ' (ro)' : ''}`
          })}`
        );
      } else {
        const volume = volumes[mount.source] ?? {};
        const name = volume.name
          ? interpolate(String(volume.name), HOME_CELL)
          : undefined;
        const id = nodeId('vol', mount.source);

        lines.push(
          `  ${id}[(${label(
            `volume ${mount.source}`,
            volume.external ? `external: ${name}` : 'created by compose'
          )})]`,
          `  ${edge(nodeId('svc', service.name), id, { note: mount.target })}`
        );
      }
    }
  }

  return mermaid(lines);
}

function servicesTable(compose) {
  return table(
    [
      'Service',
      'Image',
      'Build',
      'Host ports',
      'Networks',
      'Healthcheck',
      'Memory',
      'Capabilities',
      'Restart'
    ],
    compose.services.map(({ name, svc, build, ports, networks }) => [
      `\`${name}\``,
      code(svc.image),
      build ? code(build.dockerfile) : '',
      ports
        .map(({ ip, published, target }) => `${ip}:${published} to ${target}`)
        .join(', '),
      networks.map(({ name: net }) => net).join(', '),
      healthSummary(svc),
      [svc.mem_limit, svc.mem_reservation && `reserve ${svc.mem_reservation}`]
        .filter(Boolean)
        .join(', '),
      [
        listOf(svc.cap_drop).length > 0
          ? `drop ${listOf(svc.cap_drop).join(' ')}`
          : '',
        listOf(svc.cap_add).length > 0
          ? `add ${listOf(svc.cap_add).join(' ')}`
          : '',
        listOf(svc.security_opt).join(' ')
      ]
        .filter(Boolean)
        .join('; '),
      svc.restart ?? ''
    ])
  );
}

function cellsTable() {
  const doc = parseYaml(read(PROD_COMPOSE));
  const rows = [
    ['Compose project', doc.name],
    ...Object.entries(doc.volumes ?? {})
      .filter(([, v]) => v?.name)
      .map(([key, v]) => [`Volume \`${key}\``, v.name]),
    ...Object.entries(doc.networks ?? {})
      .filter(([, n]) => n?.name)
      .map(([key, n]) => [`Network \`${key}\``, n.name])
  ];

  for (const [name, svc] of Object.entries(doc.services ?? {})) {
    for (const [net, value] of Object.entries(svc.networks ?? {})) {
      for (const alias of listOf(value?.aliases))
        rows.push([`Alias of \`${name}\` on \`${net}\``, alias]);
    }

    for (const file of listOf(svc.env_file))
      rows.push([`Env file of \`${name}\``, file]);

    for (const [key, value] of envEntries(svc.environment)) {
      if (value.includes('${CELL'))
        rows.push([`\`${key}\` of \`${name}\``, value]);
    }
  }

  return table(
    ['Name', ...CELLS.map(({ label: cell }) => cell)],
    rows.map(([what, expr]) => [
      what,
      ...CELLS.map(({ env }) => code(interpolate(String(expr), env)))
    ])
  );
}

// --- section: image build ---------------------------------------------------

function dockerignoreTable(builds) {
  const used = new Set(
    builds.flatMap(({ context, dockerfile }) => [
      posix.join(context, '.dockerignore'),
      `${dockerfile}.dockerignore`
    ])
  );

  return table(
    ['File', 'Read by a build', 'Patterns'],
    trackedFiles('*.dockerignore').map((file) => [
      code(file),
      used.has(file)
        ? 'yes'
        : 'no: no build has this context or this Dockerfile',
      read(file)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => `\`${line}\``)
        .join(' ')
    ])
  );
}

function registryRepos() {
  const doc = parseYaml(read(DEPLOY_WORKFLOW));
  const repos = new Map();

  for (const job of Object.values(doc.jobs ?? {})) {
    const steps = listOf(job.steps);

    for (const step of steps) {
      if (!String(step.uses ?? '').startsWith('docker/build-push-action'))
        continue;

      const metaId = /steps\.([\w-]+)\.outputs/.exec(
        String(step.with?.tags)
      )?.[1];
      const meta = steps.find(({ id }) => id === metaId);

      if (meta?.with?.images) {
        repos.set(step.with.file, workflowVars(meta.with.images));
      }
    }
  }

  return repos;
}

function imageBuild(prod) {
  const builds = prod.services
    .filter(({ build }) => build)
    .map(({ name, svc, build }) => ({ name, image: svc.image, ...build }));
  const repos = registryRepos();
  const lines = ['flowchart LR'];
  const detail = [];

  for (const { name, image, context, dockerfile } of builds) {
    const stages = parseDockerfile(dockerfile);
    const prefix = nodeId('b', name);
    const ctx = `${prefix}_ctx`;

    lines.push(
      `  ${ctx}[/${label(`build context ${context}`, `Dockerfile ${dockerfile}`)}/]`
    );
    lines.push(`  subgraph ${prefix}[${label(`${dockerfile}`)}]`);

    for (const stage of stages) {
      const { name: base, pinned } = baseImage(stage.base);
      const fromStage = stages.some((s) => s.name === base);

      lines.push(
        `    ${prefix}_${stage.name}[${label(`stage ${stage.name}`, fromStage ? '' : `FROM ${base}${pinned ? ' (digest-pinned)' : ''}`)}]`
      );
    }

    lines.push('  end');

    for (const stage of stages) {
      const id = `${prefix}_${stage.name}`;

      if (stages.some((s) => s.name === stage.base)) {
        lines.push(
          `  ${edge(`${prefix}_${stage.base}`, id, { note: 'FROM' })}`
        );
      }

      for (const { op, rest } of stage.steps) {
        detail.push([
          code(dockerfile),
          stage.name,
          op,
          `\`${rest.replaceAll('`', "'")}\``
        ]);

        if (op === 'COPY') {
          const { from, sources, target } = copyArgs(rest);

          lines.push(
            from
              ? `  ${edge(`${prefix}_${from}`, id, { note: `COPY ${sources.join(' ')} to ${target}` })}`
              : `  ${edge(ctx, id, { note: `COPY ${sources.join(' ')}` })}`
          );
        }

        if (op === 'RUN') {
          for (const url of downloads(rest)) {
            const host = new URL(url).hostname;
            const dl = nodeId('dl', host);

            lines.push(
              `  ${dl}[${label(`download at build time: ${host}`)}]`,
              `  ${edge(dl, id, { note: url })}`
            );
          }
        }
      }
    }

    const final = stages.at(-1);
    const out = `${prefix}_image`;
    const steps = entrypointSteps(final);
    const user = final.steps.findLast(({ op }) => op === 'USER')?.rest;
    const expose = final.steps
      .filter(({ op }) => op === 'EXPOSE')
      .map(({ rest }) => rest);

    lines.push(
      `  ${out}[${label(
        `image of service ${name}`,
        `compose: ${image}`,
        repos.has(dockerfile) ? `pushed to ${repos.get(dockerfile)}` : '',
        user ? `runs as ${user}` : '',
        expose.length > 0 ? `EXPOSE ${expose.join(' ')}` : ''
      )}]`,
      `  ${edge(`${prefix}_${final.name}`, out)}`
    );

    if (steps.length > 0) {
      lines.push(
        `  ${out}_entry[${label('entrypoint at container start', ...steps.map((s, i) => `${i + 1}. ${s}`))}]`,
        `  ${edge(out, `${out}_entry`, { kind: '-.->' })}`
      );
    }
  }

  return {
    diagram: mermaid(lines),
    detail: table(['Dockerfile', 'Stage', 'Instruction', 'Arguments'], detail),
    ignore: dockerignoreTable(builds)
  };
}

// --- section: delivery ------------------------------------------------------

function stepLabel(step) {
  return step.name ?? step.uses ?? String(step.run ?? '').split('\n')[0];
}

function scriptOutline(script) {
  const out = [];
  let skipUntil;

  for (const raw of String(script)
    .replaceAll(/\s*\\\n\s*/g, ' ')
    .split('\n')) {
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();

    if (skipUntil !== undefined) {
      if (line === '}' && indent === skipUntil) skipUntil = undefined;

      continue;
    }

    if (/^[\w-]+\(\)\s*\{$/.test(line)) {
      skipUntil = indent;
      continue;
    }

    if (!line || line.startsWith('#')) continue;

    const control = /^(if|elif|else|while|for)\b/.test(line);
    const effect =
      /^(git|git_\w+|docker|timeout|bash|exit|cp)\b|^echo "\$/.test(line);

    if (control || effect) out.push({ indent, line });
  }

  const base = Math.min(...out.map(({ indent }) => indent));

  return out.map(({ indent, line }) => `${' '.repeat(indent - base)}${line}`);
}

function delivery() {
  const doc = parseYaml(read(DEPLOY_WORKFLOW));
  const lines = ['flowchart LR'];
  const triggers = Object.keys(doc.on ?? {});
  const outlines = [];
  const registries = new Set();

  for (const trigger of triggers) {
    const spec = doc.on[trigger];
    const what = spec?.workflows
      ? `${trigger}: ${listOf(spec.workflows).join(', ')} ${listOf(spec.types).join(', ')} on ${listOf(spec.branches).join(', ')}`
      : trigger;

    lines.push(`  ${nodeId('trig', trigger)}([${label(what)}])`);
  }

  for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
    const steps = listOf(job.steps);
    const needs = listOf(job.needs);

    lines.push(
      `  subgraph ${nodeId('job', jobId)}[${label(`job ${job.name ?? jobId}`)}]`,
      '    direction TB'
    );
    steps.forEach((step, i) => {
      lines.push(
        `    ${nodeId(jobId, i)}[${label(stepLabel(step), step.uses && step.name ? step.uses : '')}]`
      );

      if (i > 0)
        lines.push(`    ${nodeId(jobId, i - 1)} --> ${nodeId(jobId, i)}`);
    });
    lines.push('  end');

    if (needs.length === 0) {
      for (const trigger of triggers)
        lines.push(`  ${edge(nodeId('trig', trigger), nodeId('job', jobId))}`);
    }

    for (const need of needs)
      lines.push(
        `  ${edge(nodeId('job', need), nodeId('job', jobId), { note: 'needs' })}`
      );

    steps.forEach((step, i) => {
      for (const [, image] of workflowVars(step.run ?? '').matchAll(
        /docker push (\S+)/g
      )) {
        const repo = image.replace(/:[^:/]+$/, '');
        const id = nodeId('reg', repo);

        if (!registries.has(id)) {
          registries.add(id);
          lines.push(`  ${id}[(${label(`registry ${repo}`)})]`);
        }

        lines.push(
          `  ${edge(nodeId(jobId, i), id, { note: `tag ${image.split(':').at(-1)}` })}`
        );
      }

      if (step.with?.script) {
        outlines.push({
          title: `${job.name ?? jobId}: ${stepLabel(step)}`,
          lines: scriptOutline(step.with.script)
        });
        lines.push(
          `  hostcompose[${label('docker compose on the host', `${PROD_COMPOSE} at the deployed commit`)}]`,
          `  ${edge(nodeId(jobId, i), 'hostcompose', { note: 'SSH script' })}`
        );
      }
    });
  }

  return { diagram: mermaid(lines), outlines };
}

// --- section: development and CI --------------------------------------------

function devPortKeys(dev) {
  const sources = [read(DEV_ENV_EXAMPLE), read(DEV_COMPOSE)].join('\n');
  const keys = new Map();

  for (const [, key, value] of sources.matchAll(/\b([A-Z][A-Z0-9_]+)=(\S+)/g)) {
    const port =
      /localhost:(\d+)/.exec(value)?.[1] ??
      (/^\d+$/.test(value) ? value : undefined);

    if (!port) continue;

    for (const service of dev.services) {
      if (service.ports.some(({ published }) => published === port)) {
        const list = keys.get(service.name) ?? new Set();

        list.add(`${key}=${value}`);
        keys.set(service.name, list);
      }
    }
  }

  return keys;
}

function ciContainers() {
  const doc = parseYaml(read(CI_WORKFLOW));
  const jobs = [];

  for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
    const containers = [];
    const builds = [];

    for (const step of listOf(job.steps)) {
      const run = String(step.run ?? '').replaceAll(/\\\n\s*/g, ' ');

      for (const [command] of run.matchAll(/docker run [^\n]+/g)) {
        const name = /--name\s+(\S+)/.exec(command)?.[1];
        const ports = [...command.matchAll(/-p\s+(\S+)/g)].map(([, p]) => p);
        const tokens = command
          .replaceAll(/\s(-[-\w]+)\s+(?!-)\S+/g, ' ')
          .split(/\s+/);
        const image = tokens.find(
          (t, i) => i > 1 && !t.startsWith('-') && /[:/]/.test(t)
        );

        containers.push({ name, ports, image });
      }

      if (String(step.uses ?? '').startsWith('docker/build-push-action')) {
        builds.push({ file: step.with?.file, push: step.with?.push });
      }
    }

    if (containers.length > 0 || builds.length > 0)
      jobs.push({ jobId, name: job.name ?? jobId, containers, builds });
  }

  return jobs;
}

function devAndCi() {
  const dev = loadCompose(DEV_COMPOSE, {});
  const keys = devPortKeys(dev);
  const proxy = read('client/proxy.conf.mjs');
  const contexts = [...proxy.matchAll(/context:\s*\[([^\]]+)\]/g)].map(
    ([, c]) => c.replaceAll(/['\s]/g, '')
  );
  const target = /process\.env\.BACKEND_URL \|\| '([^']+)'/.exec(proxy)?.[1];
  const lines = ['flowchart LR'];

  lines.push(
    `  subgraph devhost[${label('Developer machine: processes on the host')}]`,
    `    dev_client[${label('client: npm start (ng serve)', `proxy.conf.mjs sends ${contexts.join(', ')} to BACKEND_URL, default ${target}`)}]`,
    `    dev_server[${label('server: npm run start:dev', 'reads server/.env')}]`,
    `    dev_mock[${label('mock-server: npm run start:dev', 'in-memory, no container needed')}]`,
    '  end',
    `  ${edge('dev_client', 'dev_server', { note: target })}`,
    `  ${edge('dev_client', 'dev_mock', { kind: '-.->', note: `or ${target}` })}`,
    `  subgraph devcompose[${label(`${DEV_COMPOSE}: backing services`)}]`
  );

  for (const service of dev.services) {
    const ports = service.ports
      .map(({ published, target: t }) => `localhost:${published} to ${t}`)
      .join(', ');

    lines.push(
      `    ${nodeId('dev', service.name)}[${label(service.name, service.svc.image, ports)}]`
    );
  }

  lines.push('  end');

  for (const service of dev.services) {
    const notes = keys.get(service.name);

    if (notes)
      lines.push(
        `  ${edge('dev_server', nodeId('dev', service.name), { note: [...notes].join(', ') })}`
      );
  }

  for (const { jobId, name, containers, builds } of ciContainers()) {
    lines.push(
      `  subgraph ${nodeId('ci', jobId)}[${label(`CI job ${name} (${CI_WORKFLOW})`)}]`
    );

    for (const { name: cname, ports, image } of containers) {
      lines.push(
        `    ${nodeId(`ci_${jobId}`, cname)}[${label(`docker run ${cname}`, image, ports.map((p) => `-p ${p}`).join(' '))}]`
      );
    }

    for (const { file, push } of builds) {
      lines.push(
        `    ${nodeId(`ci_${jobId}`, file)}[${label(`build ${file}`, push === false ? 'no push' : '')}]`
      );
    }

    lines.push('  end');
  }

  return mermaid(lines);
}

// --- self-test --------------------------------------------------------------

/**
 * Planted cases for the parsers whose mistakes the generated file cannot
 * show: a wrong interpolation gives a plausible but wrong cell name, and
 * `graph:check` only compares the file with the same wrong output.
 */
export function dockerGraphSelfTest() {
  const cases = [
    ['nexus${CELL:+-${CELL}}', { CELL: undefined }, 'nexus'],
    ['nexus${CELL:+-${CELL}}', { CELL: 'ru' }, 'nexus-ru'],
    [
      '${CELL:+nexus-}${CELL:-shared-network}${CELL:+-proxy}',
      { CELL: undefined },
      'shared-network'
    ],
    [
      '${CELL:+nexus-}${CELL:-shared-network}${CELL:+-proxy}',
      { CELL: 'ru' },
      'nexus-ru-proxy'
    ],
    [
      '${CELL:+cells/${CELL}/}server/.env',
      { CELL: 'ru' },
      'cells/ru/server/.env'
    ],
    ['${A-x}', { A: '' }, ''],
    ['${A:-x}', { A: '' }, 'x'],
    ['${A+y}', { A: '' }, 'y'],
    ['${A:+y}', { A: '' }, ''],
    ['${OTHER:-kept}', {}, '${OTHER:-kept}']
  ];
  const failures = cases
    .map(([input, env, expected]) => ({
      input,
      env,
      expected,
      actual: interpolate(input, env)
    }))
    .filter(({ expected, actual }) => expected !== actual);
  const port = splitOutside('127.0.0.1:${PORT:-4200}:8080', ':');

  if (port.join('|') !== '127.0.0.1|${PORT:-4200}|8080') {
    failures.push({
      input: 'port split',
      expected: '3 parts',
      actual: port.join('|')
    });
  }

  return failures;
}

// --- document ---------------------------------------------------------------

export function dockerGraphMarkdown(root) {
  ROOT = root;

  const prod = loadCompose(PROD_COMPOSE, HOME_CELL);
  const config = configLinks(prod);
  const build = imageBuild(prod);
  const deploy = delivery();
  const parts = [
    '# Docker graph',
    '',
    'Generated by `npm run graph` (from `server/`) from the compose files, the Dockerfiles, the configs that name another container, the workflows and the egress lists of `shared/`. Do not edit this file. CI runs `npm run graph:check` and fails when the file is out of date.',
    '',
    `The production names are those of the \`intl\` cell (\`CELL\` unset). A value in \`\${...}\` that does not depend on \`CELL\` comes from an env file on the host, which is not in the repository (\`.env.example\` and \`cells/.env.example\` are the templates).`,
    '',
    `## Production: connections at run time`,
    '',
    `Source: \`${PROD_COMPOSE}\`. A solid arrow is a connection that a config file names: an environment value of the service, the nginx config of its image, or a Prometheus or Grafana file that it mounts. Each service is also on the network \`default\` of the project.`,
    '',
    ...productionTopology(prod, config),
    '',
    '## Production: start order and storage',
    '',
    `Source: \`${PROD_COMPOSE}\`. A dotted arrow is \`depends_on\`: the service starts after the other one is started or healthy.`,
    '',
    ...startOrderAndStorage(prod),
    '',
    '## Production: services',
    '',
    ...servicesTable(prod),
    '',
    '## Production: names of each cell',
    '',
    'The names that `CELL` changes. `scripts/cell.sh` runs a cell other than `intl` with its own env file.',
    '',
    ...cellsTable(),
    '',
    '## Image build',
    '',
    'Each image is built from the repository root as the build context. The Deploy workflow builds, scans and pushes it (next section).',
    '',
    ...build.diagram,
    '',
    '### Instructions',
    '',
    ...build.detail,
    '',
    '### Build context filters',
    '',
    ...build.ignore,
    '',
    '## Delivery',
    '',
    `Source: \`${DEPLOY_WORKFLOW}\`.`,
    '',
    ...deploy.diagram
  ];

  for (const { title, lines } of deploy.outlines) {
    parts.push(
      '',
      `### ${title}`,
      '',
      'The conditions and the commands that change state, in the order of the script:',
      '',
      '```text',
      ...lines,
      '```'
    );
  }

  parts.push(
    '',
    '## Development and CI',
    '',
    `Sources: \`${DEV_COMPOSE}\`, \`${DEV_ENV_EXAMPLE}\`, \`client/proxy.conf.mjs\` and the \`docker\` steps of \`${CI_WORKFLOW}\`. An arrow from the server names the setting that points it at the container.`,
    '',
    ...devAndCi()
  );

  return `${parts.join('\n')}\n`;
}

export const DOCKER_GRAPH_FILE = 'architecture/docker-graph.md';
