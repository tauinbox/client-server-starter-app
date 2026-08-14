import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { escapeMentions, findMentions } from './at-mentions.mjs';

// Runs as the `postchangelog` lifecycle of commit-and-tag-version, after the
// file is written and before the release commit, so the escaped form is what
// gets committed, tagged and published.
const __dirname = dirname(fileURLToPath(import.meta.url));
const changelogPath = resolve(__dirname, '..', '..', 'CHANGELOG.md');

const changelog = readFileSync(changelogPath, 'utf-8');
const mentions = findMentions(changelog);

if (mentions.length > 0) {
  writeFileSync(changelogPath, escapeMentions(changelog), 'utf-8');
  console.log(
    `Escaped ${mentions.length} GitHub mention(s) in CHANGELOG.md: ${mentions
      .map((login) => `@${login}`)
      .join(', ')}`
  );
}
