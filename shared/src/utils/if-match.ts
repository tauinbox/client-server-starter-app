// The version column is a PostgreSQL `integer`; a larger value cannot be the
// version of a row.
const MAX_VERSION = 2_147_483_647;

const VERSION_PATTERN = /^[1-9]\d*$/;

// RFC 9110 8.8.3. A tag may hold a comma, so the list is read tag by tag.
const ENTITY_TAG = /(W\/)?"([\x21\x23-\x7E\x80-\xFF]*)"/y;
const OWS = /[ \t]*/y;
// RFC 9110 5.6.1: a recipient accepts empty list elements.
const SEPARATORS = /[ \t]*(?:,[ \t]*)*/y;

export type IfMatchCondition =
  { any: true } | { any: false; versions: readonly number[] };

export function versionEtag(version: number): string {
  return `"${version}"`;
}

function skip(pattern: RegExp, text: string, index: number): number {
  pattern.lastIndex = index;
  pattern.exec(text);
  return pattern.lastIndex;
}

/**
 * RFC 9110 13.1.1. If-Match uses the strong comparison, so a weak tag is valid
 * syntax that matches nothing.
 */
export function parseIfMatch(
  header: string | undefined
): IfMatchCondition | 'missing' | 'invalid' {
  if (header === undefined || header.trim() === '') return 'missing';
  if (header.trim() === '*') return { any: true };

  const versions: number[] = [];
  let tags = 0;
  let index = skip(SEPARATORS, header, 0);
  while (index < header.length) {
    ENTITY_TAG.lastIndex = index;
    const tag = ENTITY_TAG.exec(header);
    if (!tag) return 'invalid';
    tags += 1;
    const [, weak, opaque] = tag;
    if (!weak && VERSION_PATTERN.test(opaque)) {
      const version = Number(opaque);
      if (version <= MAX_VERSION) versions.push(version);
    }

    index = skip(OWS, header, ENTITY_TAG.lastIndex);
    if (index < header.length && header[index] !== ',') return 'invalid';
    index = skip(SEPARATORS, header, index);
  }
  if (tags === 0) return 'invalid';
  return { any: false, versions };
}

export function ifMatchHolds(
  condition: IfMatchCondition,
  currentVersion: number
): boolean {
  return condition.any || condition.versions.includes(currentVersion);
}
