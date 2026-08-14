/**
 * A code identifier written bare in a commit subject (`@Authorize`, `@v4`)
 * reaches CHANGELOG.md and the release body verbatim, where it credits whatever
 * account owns that login and lands in the release page's Contributors block.
 * It arrives in two shapes:
 *
 * - conventional-changelog links lowercase mentions itself, so the generated
 *   file already holds `[@v4](https://github.com/v4)`;
 * - capitalized ones stay bare in the file and are linked by GitHub's renderer,
 *   which - unlike the generator - matches case-insensitively.
 *
 * Both become inert as code spans. A mention only starts at a word boundary:
 * the `@` of an email local part or of a URL is never one.
 */
const BARE_MENTION = '(^|[\\s([])@([A-Za-z0-9][A-Za-z0-9-]*)(\\(\\))?';
const MENTION_LINK =
  '\\[@([A-Za-z0-9][A-Za-z0-9-]*)\\]\\(https://github\\.com/\\1\\)';
const CODE_SPAN = /(`[^`]*`)/;

const mapOutsideCodeSpans = (markdown, mapText) =>
  markdown
    .split(CODE_SPAN)
    .map((part, index) => (index % 2 === 1 ? part : mapText(part)))
    .join('');

const unlinkMentions = (markdown) =>
  markdown.replace(new RegExp(MENTION_LINK, 'g'), '`@$1`');

/** Logins that would credit a GitHub account, without their leading `@`. */
export function findMentions(markdown) {
  const found = [...markdown.matchAll(new RegExp(MENTION_LINK, 'g'))].map(
    (match) => match[1]
  );

  mapOutsideCodeSpans(unlinkMentions(markdown), (text) => {
    for (const match of text.matchAll(new RegExp(BARE_MENTION, 'g'))) {
      found.push(match[2]);
    }
    return text;
  });

  return found;
}

/** Rewrites every mention as a code span so GitHub stops linking it. */
export function escapeMentions(markdown) {
  return mapOutsideCodeSpans(unlinkMentions(markdown), (text) =>
    text.replace(new RegExp(BARE_MENTION, 'g'), '$1`@$2$3`')
  );
}
